<script lang="ts">
  import { onMount } from "svelte";
  import type { HostApp, AppConnection, AppSummary, ImportableApp } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { track } from "../downloads.js";
  import { debounce } from "../util/debounce.js";
  import StatusPill from "../components/StatusPill.svelte";
  import Button from "../components/Button.svelte";
  import SearchField from "../components/SearchField.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import Spinner from "../components/Spinner.svelte";
  import ImportDialog from "../components/ImportDialog.svelte";
  import ConfirmDialog from "../components/ConfirmDialog.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import PluginIcon, { LOGO_SIZE } from "../components/PluginIcon.svelte";
  import AppDetail from "../components/AppDetail.svelte";
  import ViewToggle from "../components/ViewToggle.svelte";
  import ItemBox from "../components/ItemBox.svelte";
  import ItemList from "../components/ItemList.svelte";
  import { knownViewMode, loadViewMode, saveViewMode, type ViewMode } from "../viewMode.js";

  let apps = $state<HostApp[]>([]);
  let conns = $state<Record<string, AppConnection | null>>({});
  let connError = $state("");
  let loaded = $state(false);

  let busy = $state<Record<string, boolean>>({});
  let summaries = $state<Record<string, AppSummary | null>>({});
  let summaryErrors = $state<Record<string, string>>({});
  const summaryGen: Record<string, number> = {};

  let selected = $state<string | null>(null);
  let uninstalling = $state<HostApp | null>(null);

  let importable = $state<ImportableApp[]>([]);
  let importApp = $state<string | null>(null);
  let importAppLabel = $state("");

  let view = $state<ViewMode>(knownViewMode("apps") ?? "list");
  let viewLoaded = $state(knownViewMode("apps") !== null);
  let searchRaw = $state("");
  let search = $state("");

  const applySearch = debounce((value: string) => {
    search = value;
  }, 120);

  $effect(() => {
    applySearch(searchRaw);
  });

  const hostApps = $derived(apps.filter((app) => app.id !== "forebay"));
  const visibleApps = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return hostApps;
    return hostApps.filter((app) =>
      app.label.toLowerCase().includes(term)
      || app.id.toLowerCase().includes(term)
      || (conns[app.id]?.loaderId ?? "").toLowerCase().includes(term));
  });
  const selectedApp = $derived(hostApps.find((a) => a.id === selected) ?? null);
  const connectedCount = $derived(hostApps.filter((app) => isConnected(conns[app.id])).length);

  function setView(mode: ViewMode): void {
    view = mode;
    void saveViewMode("apps", mode);
  }

  // Fully connected means the app runs through the local API: its CLI is present
  // and, where it declares a loader, that loader is installed.
  function isConnected(c: AppConnection | null | undefined): boolean {
    if (!c) return false;
    return c.cliPresent && (c.loaderId ? c.loaderInstalled : true);
  }

  function statusLabel(c: AppConnection | null | undefined): string {
    if (isConnected(c)) return "Connected";
    if (c?.cliPresent) return "Loader not installed";
    return "Not detected";
  }

  function ctaLabel(c: AppConnection | null | undefined): string {
    if (!c?.loaderId) return "Install CLI";
    if (c.cliPresent && !c.loaderInstalled) return "Install loader";
    return "Connect";
  }

  function canImport(appId: string): boolean {
    return importable.some((a) => a.app === appId && a.hasConfig);
  }

  function openImport(app: HostApp): void {
    importApp = app.id;
    importAppLabel = app.label;
  }

  async function loadApps(): Promise<void> {
    const result = await forebay.appsList();
    if (result.ok) apps = result.data;
  }

  async function loadConn(app: string): Promise<void> {
    const result = await forebay.appsConnection(app);
    if (result.ok) {
      conns = { ...conns, [app]: result.data };
      connError = "";
    } else {
      connError = result.error;
    }
  }

  async function loadImportable(): Promise<void> {
    const result = await forebay.importApps();
    if (result.ok) importable = result.data;
  }

  // Fetch a summary only when its detail opens, so the list scales to many apps.
  function loadSummary(app: string): void {
    const gen = (summaryGen[app] ?? 0) + 1;
    summaryGen[app] = gen;
    summaries = { ...summaries, [app]: null };
    summaryErrors = { ...summaryErrors, [app]: "" };
    forebay.appsSummary(app).then((result) => {
      if (summaryGen[app] !== gen) return;
      if (result.ok) {
        summaries = { ...summaries, [app]: result.data };
      } else {
        summaryErrors = { ...summaryErrors, [app]: result.error };
      }
    });
  }

  function open(app: HostApp): void {
    selected = app.id;
    if (!(app.id in summaries)) loadSummary(app.id);
  }

  async function withBusy(app: string, action: () => Promise<unknown>): Promise<void> {
    if (busy[app]) return;
    busy = { ...busy, [app]: true };
    try {
      await action();
    } finally {
      busy = { ...busy, [app]: false };
    }
  }

  // The loader carries app-install: connecting installs the loader, which pulls
  // in its own CLI. Apps without a loader fall back to a direct CLI install.
  async function handlePrimary(app: HostApp): Promise<void> {
    if (conns[app.id]?.loaderId) {
      await withBusy(app.id, () => track(`Connect ${app.label}`, app.id, () => forebay.appsInstallLoader(app.id)));
    } else {
      await withBusy(app.id, () => track(`Install ${app.label} CLI`, app.id, () => forebay.appsInstallCli(app.id)));
    }
    await loadConn(app.id);
  }

  async function confirmUninstall(): Promise<void> {
    const app = uninstalling;
    uninstalling = null;
    if (app) await handleUninstall(app, false);
  }

  async function handleUninstall(app: HostApp, wipe: boolean): Promise<void> {
    await track(`Uninstall ${app.label}`, app.id, () => forebay.appsUninstallCli(app.id, wipe));
    const { [app.id]: _removed, ...rest } = summaries;
    summaries = rest;
    selected = null;
    await loadConn(app.id);
  }

  onMount(() => {
    Promise.all([loadApps(), loadImportable()])
      .then(() => Promise.all(apps.filter((a) => a.id !== "forebay").map((a) => loadConn(a.id))))
      .finally(() => (loaded = true));
    loadViewMode("apps").then((mode) => { view = mode; viewLoaded = true; });
  });
</script>

<PageHeader
  title="Apps"
  subtitle={loaded && hostApps.length > 0
    ? `${connectedCount} of ${hostApps.length} connected and routing through the local API.`
    : "Connect the host CLIs Forebay routes through the local API."}
/>

{#if connError}
  <p class="error">Could not load app status: {connError}</p>
{/if}

{#snippet appBox(app: HostApp, view: ViewMode)}
  {@const c = conns[app.id]}
  {@const connected = isConnected(c)}
  <ItemBox
    {view}
    testid={"app-" + app.id}
    title={app.label}
    subtitle={c?.loaderId ?? "No loader"}
    monoSubtitle
    selected={connected}
    openLabel={`Open ${app.label}`}
    onOpen={() => open(app)}
  >
    {#snippet icon()}
      <PluginIcon name={app.label} icon={app.icon} size={view === "grid" ? LOGO_SIZE.list : LOGO_SIZE.compact} />
    {/snippet}
    {#snippet badges()}
      <span class="rchip" class:on={c?.cliPresent}>CLI</span>
      {#if c?.loaderId}<span class="rchip" class:on={c?.loaderInstalled}>Loader</span>{/if}
    {/snippet}
    {#snippet actions()}
      <StatusPill variant={connected ? "good" : "off"} label={statusLabel(c)} />
      {#if !connected}
        <Button variant="primary" disabled={busy[app.id]} onclick={() => handlePrimary(app)}>
          {#if busy[app.id]}<Spinner />{/if}
          {ctaLabel(c)}
        </Button>
      {:else}
        <Button variant="danger" onclick={() => (uninstalling = app)}>Uninstall</Button>
      {/if}
    {/snippet}
  </ItemBox>
{/snippet}

{#snippet appsEmptyState()}
  {#if hostApps.length === 0}
    <EmptyState message="No apps registered yet." />
  {:else if visibleApps.length === 0}
    <EmptyState message="No app matches your search." actionLabel="Clear search" onAction={() => (searchRaw = "")} />
  {/if}
{/snippet}

{#if !loaded || !viewLoaded}
  <div class="skeletons">
    <Skeleton height="60px" radius="12px" />
    <Skeleton height="60px" radius="12px" />
  </div>
{:else}
  <div class="toolbar">
    <SearchField bind:value={searchRaw} placeholder="Search apps" />
    <ViewToggle value={view} onChange={setView} />
  </div>

  <ItemList
    items={visibleApps}
    key={(app) => app.id}
    {view}
    testid={view === "grid" ? "apps-grid" : "apps-list"}
  >
    {#snippet item(app)}{@render appBox(app, view)}{/snippet}
    {#snippet empty()}{@render appsEmptyState()}{/snippet}
  </ItemList>
{/if}

{#if selectedApp}
  <AppDetail
    app={selectedApp}
    summary={summaries[selectedApp.id] ?? null}
    summaryError={summaryErrors[selectedApp.id] ?? ""}
    connection={conns[selectedApp.id] ?? null}
    busy={busy[selectedApp.id] ?? false}
    canImport={canImport(selectedApp.id)}
    onClose={() => (selected = null)}
    onImport={() => selectedApp && openImport(selectedApp)}
    onPrimary={() => selectedApp && handlePrimary(selectedApp)}
    onUninstall={(wipe) => selectedApp && handleUninstall(selectedApp, wipe)}
  />
{/if}

{#if uninstalling}
  <ConfirmDialog
    title={`Uninstall ${uninstalling.label}?`}
    message={`This removes the ${uninstalling.label} CLI from this machine. Plugins and configuration stay in place.`}
    confirmLabel="Uninstall"
    danger
    onCancel={() => (uninstalling = null)}
    onConfirm={confirmUninstall}
  />
{/if}

{#if importApp}
  <ImportDialog
    app={importApp}
    label={importAppLabel}
    onClose={() => (importApp = null)}
    onDone={() => {
      const target = importApp;
      if (target) {
        const { [target]: _removed, ...rest } = summaries;
        summaries = rest;
        if (selected === target) loadSummary(target);
        loadConn(target);
      }
    }}
  />
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 2px 12px;
    flex-wrap: wrap;
  }
  .rchip {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--faint);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px 6px;
  }
  .rchip.on {
    color: var(--good);
    border-color: color-mix(in srgb, var(--good) 40%, var(--border));
  }
  .skeletons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .error {
    color: var(--crit);
    font-size: 13px;
  }
</style>
