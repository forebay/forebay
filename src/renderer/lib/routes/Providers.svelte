<script lang="ts">
  import { onMount } from "svelte";
  import type { ProviderRow as ProviderRowData, HostApp } from "@forebay/shared";
  import { renderForebayMark } from "@forebay/shared";
  import StatusPill, { type StatusVariant } from "../components/StatusPill.svelte";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import { navigate } from "../router.js";
  import { debounce } from "../util/debounce.js";
  import StatCard from "../components/StatCard.svelte";
  import SearchField from "../components/SearchField.svelte";
  import Chip from "../components/Chip.svelte";
  import ProviderRow from "../components/ProviderRow.svelte";
  import Button from "../components/Button.svelte";
  import ImportDialog from "../components/ImportDialog.svelte";
  import CustomEndpointsDialog from "../components/CustomEndpointsDialog.svelte";
  import CollapsibleGroup from "../components/CollapsibleGroup.svelte";
  import ItemBox from "../components/ItemBox.svelte";
  import ItemList from "../components/ItemList.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import ToggleSwitch from "../components/ToggleSwitch.svelte";
  import PluginIcon, { LOGO_SIZE } from "../components/PluginIcon.svelte";
  import ViewToggle from "../components/ViewToggle.svelte";
  import ProviderDetail from "../components/ProviderDetail.svelte";
  import { knownViewMode, loadViewMode, saveViewMode, type ViewMode } from "../viewMode.js";

  type Filter = "all" | "connected" | "oauth" | "apikey";

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "connected", label: "Connected" },
    { id: "oauth", label: "OAuth" },
    { id: "apikey", label: "API key" },
  ];

  const VIRTUALIZE_THRESHOLD = 20;
  const PROVIDER_ROW_HEIGHT = 64;

  let rows = $state<ProviderRowData[]>([]);
  let loadError = $state("");
  let loaded = $state(false);
  let searchRaw = $state("");
  let search = $state("");
  let filter = $state<Filter>("all");
  let importNotes = $state<string[]>([]);
  let importError = $state("");
  let importApp = $state<string | null>(null);
  let importAppLabel = $state("");
  let apps = $state<HostApp[]>([]);
  let connectedOpen = $state(true);
  let availableOpen = $state(true);
  let customEndpointsOpen = $state(false);
  let view = $state<ViewMode>(knownViewMode("providers") ?? "list");
  let viewLoaded = $state(knownViewMode("providers") !== null);
  let selectedProvider = $state<ProviderRowData | null>(null);

  function setView(mode: ViewMode): void {
    view = mode;
    void saveViewMode("providers", mode);
  }

  const applySearch = debounce((value: string) => {
    search = value;
  }, 120);

  $effect(() => {
    applySearch(searchRaw);
  });

  function isConnected(row: ProviderRowData): boolean {
    return row.accountCount > 0;
  }

  function matchesFilter(row: ProviderRowData): boolean {
    switch (filter) {
      case "connected":
        return isConnected(row);
      case "oauth":
        return row.authKind === "oauth";
      case "apikey":
        return row.authKind === "api-key";
      default:
        return true;
    }
  }

  function matchesSearch(row: ProviderRowData): boolean {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return row.id.toLowerCase().includes(term) || row.label.toLowerCase().includes(term);
  }

  const filtered = $derived(rows.filter((row) => matchesFilter(row) && matchesSearch(row)));
  const connectedRows = $derived(filtered.filter(isConnected));
  const availableRows = $derived(filtered.filter((row) => !isConnected(row)));

  const connectedCount = $derived(rows.filter(isConnected).length);
  const accountsTotal = $derived(rows.reduce((sum, row) => sum + row.accountCount, 0));
  const oauthRows = $derived(rows.filter((row) => row.authKind === "oauth"));
  const apiKeyRows = $derived(rows.filter((row) => row.authKind === "api-key"));
  const oauthConnectedCount = $derived(oauthRows.filter(isConnected).length);
  const apiKeyConnectedCount = $derived(apiKeyRows.filter(isConnected).length);

  async function load(): Promise<void> {
    const result = await forebay.providersList();
    if (result.ok) {
      rows = result.data;
      loadError = "";
    } else {
      loadError = result.error;
    }
    loaded = true;
  }

  // A provider whose plugin bundle failed to load has no metadata behind it, so every
  // other thing the row could say about it is a fallback. Say that first, and carry the
  // reason so it is one hover away rather than a mystery.
  function statusFor(row: ProviderRowData): { variant: StatusVariant; label: string; detail?: string } {
    if (row.defsError) return { variant: "warn", label: "Won't load", detail: `${row.pluginName} failed to load: ${row.defsError}` };
    return isConnected(row) ? { variant: "good", label: "Connected" } : { variant: "off", label: "Not connected" };
  }

  function accountLabel(row: ProviderRowData): string {
    if (row.accountCount === 0) return "No accounts";
    return `${row.accountCount} account${row.accountCount === 1 ? "" : "s"}`;
  }

  async function handleSetEnabled(id: string, on: boolean): Promise<void> {
    const result = await forebay.providersSetEnabled(id, on);
    if (!result.ok) toast.error(result.error);
    await load();
  }

  async function handleSetExposure(id: string, appId: string, on: boolean): Promise<void> {
    await forebay.providersSetExposure(id, appId, on);
    await load();
  }

  async function loadApps(): Promise<void> {
    const result = await forebay.appsList();
    if (result.ok) apps = result.data;
  }

  // Providers are installed into Forebay's own home too, so it belongs beside the host apps
  // here. Its mark is the one logo Forebay owns, from the canonical module, passed as markup so
  // it follows the theme.
  const availabilityApps = $derived<HostApp[]>([
    { id: "forebay", label: "Forebay", icon: renderForebayMark() },
    ...apps,
  ]);

  async function handleImport(): Promise<void> {
    importError = "";
    importNotes = [];
    const result = await forebay.importApps();
    if (!result.ok) {
      importError = result.error;
      return;
    }
    const importable = result.data.filter((a) => a.hasConfig);
    if (importable.length === 0) {
      importError = "No app config found to import.";
      return;
    }
    if (importable.length > 1) {
      navigate("apps", undefined, { redirect: true });
      return;
    }
    importApp = importable[0].app;
    importAppLabel = importable[0].label;
  }

  function handleAddProvider(): void {
    navigate("plugins", { kind: "provider" }, { redirect: true });
  }

  onMount(load);
  onMount(loadApps);
  onMount(() => {
    loadViewMode("providers").then((mode) => { view = mode; viewLoaded = true; });
  });
</script>

<div class="head">
  <div style="flex:1">
    <h1>Providers</h1>
    <p>Connect AI backends once, routed to all your apps alike.</p>
  </div>
  <Button onclick={handleImport}>Import</Button>
  <Button onclick={() => (customEndpointsOpen = true)}>Custom endpoints</Button>
  <Button variant="primary" onclick={handleAddProvider}>+ Add provider</Button>
</div>

{#if importError}
  <p class="error">{importError}</p>
{/if}
{#if importNotes.length > 0}
  <ul class="import-notes">
    {#each importNotes as note}<li>{note}</li>{/each}
  </ul>
{/if}

{#if loadError}
  <ErrorState message={`Could not load providers: ${loadError}`} onRetry={load} />
{:else if !loaded || !viewLoaded}
  <div class="skeletons">
    <Skeleton height="64px" radius="10px" />
    {#each Array(5) as _}
      <Skeleton height="46px" radius="10px" />
    {/each}
  </div>
{:else}
  <section class="summary">
    <StatCard label="Connected" value={String(connectedCount)} unit={`/ ${rows.length} providers`} />
    <StatCard label="Accounts" value={String(accountsTotal)} meta={`across ${connectedCount} providers`} />
    <StatCard label="OAuth" value={String(oauthRows.length)} meta={`${oauthConnectedCount} connected`} />
    <StatCard label="API key" value={String(apiKeyRows.length)} meta={`${apiKeyConnectedCount} connected`} />
  </section>

  <div class="toolbar">
    <SearchField bind:value={searchRaw} placeholder="Search providers" />
    {#each FILTERS as f (f.id)}
      <Chip label={f.label} on={filter === f.id} onclick={() => (filter = f.id)} />
    {/each}
    <span class="spacer"></span>
    <ViewToggle value={view} onChange={setView} />
  </div>

  {#if view === "grid"}
    <ItemList items={filtered} key={(item) => item.id} view="grid" testid="providers-grid">
      {#snippet item(entry)}{@render providerCard(entry)}{/snippet}
    </ItemList>
  {:else}
    <CollapsibleGroup label="Connected" count={connectedRows.length} bind:open={connectedOpen}>
      {#snippet body()}
        <ItemList items={connectedRows} key={(item) => item.id} rowHeight={PROVIDER_ROW_HEIGHT} virtualizeAfter={VIRTUALIZE_THRESHOLD}>
          {#snippet item(entry)}{@render providerRow(entry)}{/snippet}
        </ItemList>
      {/snippet}
    </CollapsibleGroup>

    <CollapsibleGroup label="Available" count={availableRows.length} bind:open={availableOpen}>
      {#snippet body()}
        <ItemList items={availableRows} key={(item) => item.id} rowHeight={PROVIDER_ROW_HEIGHT} virtualizeAfter={VIRTUALIZE_THRESHOLD}>
          {#snippet item(entry)}{@render providerRow(entry)}{/snippet}
        </ItemList>
      {/snippet}
    </CollapsibleGroup>
  {/if}
{/if}

{#if importApp}
  <ImportDialog
    app={importApp}
    label={importAppLabel}
    onClose={() => (importApp = null)}
    onDone={(notes) => { importNotes = notes; load(); }}
  />
{/if}

{#if customEndpointsOpen}
  <CustomEndpointsDialog onClose={() => (customEndpointsOpen = false)} />
{/if}

{#if selectedProvider}
  <ProviderDetail
    provider={selectedProvider}
    apps={availabilityApps}
    onClose={() => (selectedProvider = null)}
    onChanged={load}
  />
{/if}

{#snippet providerRow(row: ProviderRowData)}
  <ProviderRow
    testid={"provider-" + row.id}
    name={row.label}
    id={row.id}
    logo={row.icon ?? ""}
    subtitle={row.authKind === "oauth" ? "OAuth" : "API key"}
    translator={row.translator}
    status={statusFor(row)}
    apps={availabilityApps}
    exposure={row.exposure}
    accountLabel={accountLabel(row)}
    enabled={row.enabled}
    onToggle={(on) => handleSetEnabled(row.id, on)}
    onToggleExposure={(appId, on) => handleSetExposure(row.id, appId, on)}
    onOpen={() => (selectedProvider = row)}
  />
{/snippet}

{#snippet providerCard(row: ProviderRowData)}
  <ItemBox
    view="grid"
    testid={"provider-" + row.id}
    title={row.label}
    subtitle={accountLabel(row)}
    selected={isConnected(row)}
    openLabel={`View ${row.label}`}
    onOpen={() => (selectedProvider = row)}
  >
    {#snippet icon()}
      <PluginIcon icon={row.icon ?? ""} name={row.label} kind="provider" size={LOGO_SIZE.list} />
    {/snippet}
    {#snippet badges()}
      {#if row.id !== row.label}<span class="pid">{row.id}</span>{/if}
    {/snippet}
    {#snippet actions()}
      <StatusPill variant={statusFor(row).variant} label={statusFor(row).label} title={statusFor(row).detail ?? ""} />
      <div onclick={(e) => e.stopPropagation()} role="presentation">
        <ToggleSwitch checked={row.enabled} label={`${row.label} enabled`} onchange={(on) => handleSetEnabled(row.id, on)} />
      </div>
    {/snippet}
  </ItemBox>
{/snippet}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
  }
  .head h1 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -.02em;
    font-weight: 650;
  }
  .head p {
    margin: 3px 0 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .pid {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--faint);
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: 12px;
    margin-bottom: 22px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .error {
    color: var(--crit);
    font-size: 13px;
  }
  .import-notes {
    margin: 0 0 18px;
    padding: 0 0 0 18px;
    color: var(--muted);
    font-size: 12.5px;
  }
</style>
