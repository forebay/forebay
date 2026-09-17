<script lang="ts">
  import { onMount } from "svelte";
  import type { HomeLibraries, HostApp, UnifiedLibrary } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import { debounce } from "../util/debounce.js";
  import { buildUnifiedLibraries, isOrphan, orphanHomeIds } from "../util/unifiedLibraries.js";
  import { navigate } from "../router.js";
  import { track } from "../downloads.js";
  import Dialog from "../components/Dialog.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import SearchField from "../components/SearchField.svelte";
  import StatCard from "../components/StatCard.svelte";
  import Chip from "../components/Chip.svelte";
  import Button from "../components/Button.svelte";
  import AppPills from "../components/AppPills.svelte";
  import ItemBox from "../components/ItemBox.svelte";
  import ItemList from "../components/ItemList.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import ConfirmDialog from "../components/ConfirmDialog.svelte";

  const VIRTUALIZE_THRESHOLD = 20;
  const ROW_HEIGHT = 64;
  const COLUMNS = "minmax(180px, 1.6fr) 110px 96px auto";

  let homes = $state<HomeLibraries[]>([]);
  let loadError = $state("");
  let loaded = $state(false);
  let searchRaw = $state("");
  let search = $state("");
  let unusedOnly = $state(false);
  let pendingConfirm = $state<{ title: string; message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  // A row is a fixed height (the list windows itself past a threshold), so only the first few
  // users fit; the rest are one click away rather than spilling over the row below.
  let showingUsers = $state<UnifiedLibrary | null>(null);

  const applySearch = debounce((value: string) => {
    search = value;
  }, 120);

  $effect(() => {
    applySearch(searchRaw);
  });

  const term = $derived(search.trim().toLowerCase());

  // Ecosystem libraries and third-party packages answer different questions ("is my own stack
  // in place" vs "what did this pull in"), so the split stays, as a filter rather than as two
  // lists per home.
  const OWN_SCOPE = "@intisy-ai/";

  const libraries = $derived(buildUnifiedLibraries(homes));
  const homeList = $derived(homes.map((entry) => entry.home));
  // AppPills renders whichever homes it is given, so the library row says where it is
  // installed the same way a plugin row does.
  const pillApps = $derived<HostApp[]>(homeList.map((home) => ({ id: home.id, label: home.label, icon: home.icon })));

  const visible = $derived(
    libraries.filter((library) => {
      if (unusedOnly && orphanHomeIds(library).length === 0) return false;
      if (!term) return true;
      return library.specifier.toLowerCase().includes(term)
        || library.usedBy.some((plugin) => plugin.toLowerCase().includes(term));
    }),
  );

  // A library nothing uses ANYWHERE and one left over in a single home both need cleaning up,
  // so the count is of rows with anything to remove, not only of rows used by nobody at all.
  const removable = $derived(libraries.filter((library) => orphanHomeIds(library).length > 0));

  const totals = $derived({
    all: libraries.length,
    ours: libraries.filter((library) => library.specifier.startsWith(OWN_SCOPE)).length,
    unused: removable.length,
  });

  function installedIn(library: UnifiedLibrary): Record<string, boolean> {
    return Object.fromEntries(homeList.map((home) => [home.id, !!library.homes[home.id]?.installed]));
  }

  // Versions can differ per home, so the row shows one only when every home agrees; otherwise
  // it says so rather than picking one and implying the others match.
  function versionLabel(library: UnifiedLibrary): string {
    const versions = [...new Set(Object.values(library.homes).map((state) => state.version).filter(Boolean))];
    if (versions.length === 0) return "not built";
    return versions.length === 1 ? versions[0] : "mixed";
  }

  function homeLabel(homeId: string): string {
    return homeList.find((home) => home.id === homeId)?.label ?? homeId;
  }

  // Where a row is left over, saying so beats a bare "unused" that a row used elsewhere
  // would contradict.
  function leftoverNote(library: UnifiedLibrary): string {
    const orphans = orphanHomeIds(library);
    if (orphans.length === 0) return "";
    if (isOrphan(library)) return "used by nothing";
    return `left over in ${orphans.map(homeLabel).join(", ")}`;
  }

  // Both of these are removals like any other, so they report through Downloads rather than
  // running invisibly and only surfacing a toast at the end.
  async function removeWhereUnused(library: UnifiedLibrary): Promise<void> {
    const targets = orphanHomeIds(library);
    const result = await track(
      `Remove ${library.specifier}`,
      targets.map(homeLabel).join(", "),
      async () => {
        for (const homeId of targets) {
          const removed = await forebay.librariesRemove(homeId, library.specifier);
          if (!removed.ok) return removed;
        }
        return { ok: true, data: undefined } as const;
      },
    );
    if (result.ok) toast.success(`Removed ${library.specifier}`);
    else toast.error(result.error);
    await load();
  }

  async function uninstallUsers(library: UnifiedLibrary): Promise<void> {
    for (const plugin of library.usedBy) {
      const result = await track(
        `Remove ${plugin} everywhere`,
        "all homes",
        () => forebay.pluginsRemoveEverywhere(plugin),
        (data) => (data.outcomes.find((outcome) => outcome.error)?.error ?? null),
      );
      if (!result.ok) {
        toast.error(result.error);
        break;
      }
    }
    await load();
  }

  function confirmRemove(library: UnifiedLibrary): void {
    const targets = orphanHomeIds(library).map(homeLabel);
    pendingConfirm = {
      title: "Remove library?",
      message: `Remove ${library.specifier} from ${targets.join(", ")}. Nothing installed there declares it.`,
      confirmLabel: "Remove",
      run: () => removeWhereUnused(library),
    };
  }

  function confirmUninstallUsers(library: UnifiedLibrary): void {
    pendingConfirm = {
      title: "Uninstall the plugins using this?",
      message: `${library.specifier} is used by ${library.usedBy.join(", ")}. Uninstalling them everywhere is what frees it.`,
      confirmLabel: "Uninstall",
      run: () => uninstallUsers(library),
    };
  }

  // Enough names to recognise the row at a glance; the rest are behind the counter, because
  // a row that grows with its user count overlaps the row beneath it once the list windows.
  const SHOWN_USERS = 3;

  function shownUsers(library: UnifiedLibrary): string[] {
    return library.usedBy.slice(0, SHOWN_USERS);
  }

  function hiddenUserCount(library: UnifiedLibrary): number {
    return Math.max(0, library.usedBy.length - SHOWN_USERS);
  }

  function openPlugin(plugin: string): void {
    showingUsers = null;
    navigate("plugins", { plugin }, { redirect: true });
  }

  async function load(): Promise<void> {
    const result = await forebay.librariesList();
    if (result.ok) {
      homes = result.data;
      loadError = "";
    } else {
      loadError = result.error;
    }
  }

  onMount(() => {
    load().finally(() => (loaded = true));
  });
</script>

<PageHeader
  title="Libraries"
  subtitle="Every package installed alongside your plugins, and which of them use it."
/>

{#if loadError}
  <ErrorState message={"Could not load libraries: " + loadError} onRetry={load} />
{:else if !loaded}
  <div class="skeletons">
    {#each Array(4) as _}
      <Skeleton height="52px" radius="10px" />
    {/each}
  </div>
{:else}
  <section class="summary">
    <StatCard label="Libraries" value={String(totals.all)} meta={`${totals.ours} from the ecosystem`} />
    <StatCard label="Unused" value={String(totals.unused)} meta="with a copy nothing there uses" metaColor={totals.unused > 0 ? "var(--warn)" : ""} />
    <StatCard label="Homes" value={String(homeList.length)} meta="each with its own store" />
  </section>

  <div class="toolbar">
    <SearchField bind:value={searchRaw} placeholder="Search libraries" />
    <Chip label={`Unused ${totals.unused}`} on={unusedOnly} onclick={() => (unusedOnly = !unusedOnly)} />
  </div>

  {#if visible.length === 0}
    <EmptyState message={term || unusedOnly ? "No library matches your filters." : "Nothing installed alongside your plugins yet."} />
  {:else}
    <ItemList items={visible} key={(library) => library.specifier} rowHeight={ROW_HEIGHT} virtualizeAfter={VIRTUALIZE_THRESHOLD}>
      {#snippet item(library)}
        <ItemBox
          columns={COLUMNS}
          testid={"library-" + library.specifier}
          title={library.specifier}
        >
          {#snippet meta()}
            {#if isOrphan(library)}
              <span class="unused">used by nothing installed</span>
            {:else}
              <span class="users">
                <span class="lead">Used by</span>
                {#each shownUsers(library) as plugin (plugin)}
                  <button type="button" class="user" onclick={() => openPlugin(plugin)}>{plugin}</button>
                {/each}
                {#if hiddenUserCount(library) > 0}
                  <button type="button" class="more" onclick={() => (showingUsers = library)}>+{hiddenUserCount(library)} more</button>
                {/if}
              </span>
            {/if}
            {#if leftoverNote(library) && !isOrphan(library)}
              <span class="leftover">{leftoverNote(library)}</span>
            {/if}
          {/snippet}
          {#snippet actions()}
            <div class="ver" class:missing={versionLabel(library) === "not built"}>{versionLabel(library)}</div>
            <AppPills apps={pillApps} values={installedIn(library)} />
            <div>
              {#if orphanHomeIds(library).length > 0}
                <Button onclick={() => confirmRemove(library)}>Remove</Button>
              {:else}
                <Button onclick={() => confirmUninstallUsers(library)}>Uninstall users</Button>
              {/if}
            </div>
          {/snippet}
        </ItemBox>
      {/snippet}
    </ItemList>
  {/if}
{/if}

{#if showingUsers}
  {@const library = showingUsers}
  <Dialog title={library.specifier} subtitle={`Used by ${library.usedBy.length} plugins.`} width="sm" onClose={() => (showingUsers = null)}>
    {#snippet body()}
      <ul class="userlist">
        {#each library.usedBy as plugin (plugin)}
          <li><button type="button" class="user" onclick={() => openPlugin(plugin)}>{plugin}</button></li>
        {/each}
      </ul>
    {/snippet}
  </Dialog>
{/if}

{#if pendingConfirm}
  <ConfirmDialog
    title={pendingConfirm.title}
    message={pendingConfirm.message}
    confirmLabel={pendingConfirm.confirmLabel}
    danger
    onConfirm={async () => { const p = pendingConfirm; pendingConfirm = null; if (!p) return; await p.run(); }}
    onCancel={() => (pendingConfirm = null)}
  />
{/if}

<style>
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--space-md);
    margin-bottom: var(--space-2xl);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-lg);
    flex-wrap: wrap;
  }
  /* One line, always: the row has a fixed height and the counter carries the overflow. */
  .users {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-sm);
    min-width: 0;
    white-space: nowrap;
  }
  .userlist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    align-items: flex-start;
  }
  .more {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--muted);
    cursor: pointer;
    flex: none;
  }
  .more:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .lead,
  .unused {
    color: var(--faint);
  }
  .user {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .user:hover {
    text-decoration: underline;
  }
  .leftover {
    margin-left: var(--space-sm);
    color: var(--warn);
  }
  .ver {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .ver.missing {
    color: var(--warn);
  }
  .skeletons {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
</style>
