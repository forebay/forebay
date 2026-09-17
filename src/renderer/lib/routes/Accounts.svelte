<script lang="ts">
  import { onMount } from "svelte";
  import type { ProviderRow as ProviderRowData, AccountView } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import { debounce } from "../util/debounce.js";
  import { accountLabel, accountStatusInfo } from "../util/accountStatus.js";
  import AccountRow from "../components/AccountRow.svelte";
  import Button from "../components/Button.svelte";
  import SearchField from "../components/SearchField.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import StatCard from "../components/StatCard.svelte";
  import StatusPill, { type StatusVariant } from "../components/StatusPill.svelte";
  import PluginIcon, { LOGO_SIZE } from "../components/PluginIcon.svelte";
  import Card from "../components/Card.svelte";
  import ItemBox from "../components/ItemBox.svelte";
  import ItemList from "../components/ItemList.svelte";
  import VirtualList from "../components/VirtualList.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import ConfirmDialog from "../components/ConfirmDialog.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import AddAccountDialog from "../components/AddAccountDialog.svelte";

  const VIRTUALIZE_THRESHOLD = 20;
  const ACCOUNT_ROW_HEIGHT = 64;
  // A closed section is one carded ItemBox row plus the gap below it. The windowed list
  // positions by this number, so it has to match .pool's rendered pitch (measured: row
  // padding + icon/text block + card border + margin).
  const SECTION_HEADER_HEIGHT = 71;
  const POOL_COLUMNS = "minmax(150px, 1.6fr) 118px 96px auto 22px";

  // Several providers can read and write one account store (antigravity and gemini-cli
  // share a pool), so the pool, not the provider, is what has accounts. Keying sections by
  // provider showed the same account once per lane and offered to add it twice.
  type AccountPool = {
    id: string;
    label: string;
    providers: ProviderRowData[];
    // The lane whose bundle loaded, since every account call goes through a provider's
    // controller and a broken sibling would fail calls the pool can otherwise serve.
    controllerId: string;
    accountCount: number;
    error: string;
  };

  let providers = $state<ProviderRowData[]>([]);
  let providersError = $state("");
  let loaded = $state(false);
  let accountsByPool = $state<Record<string, AccountView[]>>({});
  let accountErrors = $state<Record<string, string>>({});
  let loadingAccounts = $state<Record<string, boolean>>({});
  let openSections = $state<Record<string, boolean>>({});
  let searchRaw = $state("");
  let search = $state("");
  let pendingConfirm = $state<{ title: string; message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  let addFor = $state<{ id: string; label: string } | null>(null);
  let pickerOpen = $state(false);
  let pickerFilter = $state("");
  let pickerEl = $state<HTMLDivElement | undefined>(undefined);

  const requested = new Set<string>();

  const applySearch = debounce((value: string) => {
    search = value;
  }, 120);

  $effect(() => {
    applySearch(searchRaw);
  });

  const term = $derived(search.trim().toLowerCase());
  const searching = $derived(term.length > 0);

  function toPool(lanes: ProviderRowData[]): AccountPool {
    const usable = lanes.find((lane) => !lane.defsError) ?? lanes[0];
    return {
      id: lanes[0].accountPool,
      label: lanes.map((lane) => lane.label).join(", "),
      providers: lanes,
      controllerId: usable.id,
      accountCount: Math.max(...lanes.map((lane) => lane.accountCount)),
      error: usable.defsError ?? "",
    };
  }

  const pools = $derived.by(() => {
    const lanesByPool = new Map<string, ProviderRowData[]>();
    for (const provider of providers) {
      const lanes = lanesByPool.get(provider.accountPool) ?? [];
      lanes.push(provider);
      lanesByPool.set(provider.accountPool, lanes);
    }
    return [...lanesByPool.values()].map(toPool);
  });

  const connected = $derived(pools.filter((pool) => pool.accountCount > 0));

  // Every pool gets a section, signed into or not. What keeps that affordable is that a
  // section is closed until asked for: the count on the header is the one already on the
  // provider rows, and no pool's accounts are listed until its section opens.
  const visiblePools = $derived.by(() => {
    if (!term) return pools;
    return pools.filter((pool) =>
      pool.label.toLowerCase().includes(term)
      || (accountsByPool[pool.id] ?? []).some((account) => accountLabel(account).toLowerCase().includes(term)));
  });

  const anySectionOpen = $derived(Object.values(openSections).some(Boolean));

  // A search that matched inside a section is useless with the section shut, so searching
  // opens what it matched until the search is cleared.
  function isOpen(poolId: string): boolean {
    return openSections[poolId] ?? searching;
  }

  function setOpen(pool: AccountPool, open: boolean): void {
    openSections[pool.id] = open;
    if (open) ensureAccounts(pool);
  }

  const totalAccounts = $derived(pools.reduce((sum, pool) => sum + pool.accountCount, 0));
  const brokenPools = $derived(pools.filter((pool) => pool.error));

  function statusFor(pool: AccountPool): { variant: StatusVariant; label: string; detail: string } {
    if (pool.error) return { variant: "warn", label: "Won't load", detail: `${pool.providers[0].pluginName} failed to load: ${pool.error}` };
    if (pool.accountCount > 0) return { variant: "good", label: "Connected", detail: "" };
    return { variant: "off", label: "Not connected", detail: "" };
  }

  function countLabel(count: number): string {
    if (count === 0) return "No accounts";
    return `${count} account${count === 1 ? "" : "s"}`;
  }

  // The ids behind a pool, which is the only place the shared lanes are visible now that one
  // section stands for all of them.
  function laneIds(pool: AccountPool): string {
    return pool.providers.map((provider) => provider.id).join(" · ");
  }

  const pickerPools = $derived.by(() => {
    const filter = pickerFilter.trim().toLowerCase();
    return filter ? pools.filter((pool) => pool.label.toLowerCase().includes(filter)) : pools;
  });

  // Matching a pool by name means every one of its accounts matched too, otherwise
  // searching for a provider would show its section with nothing in it.
  function accountsFor(pool: AccountPool): AccountView[] {
    const accounts = accountsByPool[pool.id] ?? [];
    if (!term || pool.label.toLowerCase().includes(term)) return accounts;
    return accounts.filter((account) => accountLabel(account).toLowerCase().includes(term));
  }

  async function loadAccounts(pool: AccountPool): Promise<void> {
    loadingAccounts[pool.id] = true;
    const result = await forebay.accountsList(pool.controllerId);
    loadingAccounts[pool.id] = false;
    if (!result.ok) {
      accountErrors[pool.id] = result.error;
      // A failed read must not count as read: the usual cause is a plugin that needs
      // repairing, and holding the failure meant the error outlived the fix until Forebay
      // restarted. Dropping the mark lets the next open try again.
      requested.delete(pool.id);
      return;
    }
    accountsByPool[pool.id] = result.data;
    accountErrors[pool.id] = "";
    // Keeps the count that decides whether this pool has a section at all in step with what
    // was just listed, so removing the last account retires the section without a second
    // round trip for every other pool. Every lane carries the pool's count, so every lane
    // is corrected.
    for (const lane of providers) {
      if (lane.accountPool === pool.id) lane.accountCount = result.data.length;
    }
  }

  function ensureAccounts(pool: AccountPool): void {
    if (requested.has(pool.id)) return;
    requested.add(pool.id);
    void loadAccounts(pool);
  }

  // Repairing a plugin happens outside this screen, so both halves of what it reported have
  // to be re-read: the provider rows carry the load failure, the pool carries the accounts.
  async function retry(pool: AccountPool): Promise<void> {
    accountErrors[pool.id] = "";
    requested.delete(pool.id);
    await load();
    const refreshed = pools.find((candidate) => candidate.id === pool.id);
    if (refreshed) ensureAccounts(refreshed);
  }

  // Searching has to look inside accounts nobody has opened yet, so a search (and only a
  // search) is what makes the screen read them all.
  $effect(() => {
    if (!term) return;
    for (const pool of pools) ensureAccounts(pool);
  });

  async function load(): Promise<void> {
    const result = await forebay.providersList();
    if (!result.ok) {
      providersError = result.error;
      providers = [];
      return;
    }
    providersError = "";
    providers = result.data;
  }

  async function handleToggle(pool: AccountPool, id: string, on: boolean): Promise<void> {
    const result = await forebay.accountsEnable(pool.controllerId, id, on);
    if (!result.ok) toast.error(result.error);
    await loadAccounts(pool);
  }

  async function handleRemove(pool: AccountPool, id: string): Promise<void> {
    const result = await forebay.accountsRemove(pool.controllerId, id);
    if (result.ok) {
      toast.success("Account removed");
    } else {
      toast.error(result.error);
    }
    await loadAccounts(pool);
  }

  function confirmRemove(pool: AccountPool, account: AccountView): void {
    pendingConfirm = {
      title: "Remove account?",
      message: `Remove ${accountLabel(account)}? You'll need to sign in again to use it.`,
      confirmLabel: "Remove",
      run: () => handleRemove(pool, account.id),
    };
  }

  function openPicker(): void {
    pickerFilter = "";
    pickerOpen = !pickerOpen;
  }

  function pickPool(pool: AccountPool): void {
    pickerOpen = false;
    addFor = { id: pool.controllerId, label: pool.label };
  }

  function closePickerOnOutsideClick(event: MouseEvent): void {
    if (!pickerOpen) return;
    if (pickerEl && event.target instanceof Node && pickerEl.contains(event.target)) return;
    pickerOpen = false;
  }

  onMount(() => {
    load().finally(() => (loaded = true));
  });
</script>

<svelte:window onclick={closePickerOnOutsideClick} />

<PageHeader title="Accounts" subtitle="Signed-in accounts across every provider, with quota and status at a glance.">
  {#snippet actions()}
    {#if loaded && !providersError && providers.length > 0}
      <div class="picker" bind:this={pickerEl}>
        <Button variant="primary" onclick={openPicker}>Add account</Button>
        {#if pickerOpen}
          <div class="menu" role="menu">
            <input
              class="filter"
              aria-label="Filter providers"
              placeholder="Filter providers"
              bind:value={pickerFilter}
            />
            <div class="menuscroll">
              {#each pickerPools as pool (pool.id)}
                <button role="menuitem" onclick={() => pickPool(pool)}>
                  <span class="mlabel">{pool.label}</span>
                  {#if pool.accountCount > 0}<span class="mcount">{pool.accountCount}</span>{/if}
                </button>
              {:else}
                <p class="mempty">No provider matches.</p>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}
</PageHeader>

{#if providersError}
  <ErrorState message={"Could not load providers: " + providersError} onRetry={load} />
{:else if !loaded}
  <div class="skeletons">
    {#each Array(5) as _}
      <Skeleton height="52px" radius="10px" />
    {/each}
  </div>
{:else}
  <section class="summary">
    <StatCard label="Accounts" value={String(totalAccounts)} meta={`across ${connected.length} of ${pools.length} providers`} />
    <StatCard label="Signed in" value={String(connected.length)} unit={`/ ${pools.length} providers`} />
    {#if brokenPools.length > 0}
      <StatCard label="Won't load" value={String(brokenPools.length)} meta="plugin build incomplete" metaColor="var(--warn)" />
    {/if}
  </section>

  <div class="toolbar">
    <SearchField bind:value={searchRaw} placeholder="Search accounts" />
  </div>

  {#if visiblePools.length === 0}
    <p class="empty">
      {searching
        ? "No account or provider matches your search."
        : "No providers installed yet. Install one from Plugins to sign in."}
    </p>
  {:else if visiblePools.length > VIRTUALIZE_THRESHOLD && !anySectionOpen}
    <!-- Closed sections are uniform headers, so the long list windows; opening one makes the
         heights uneven and narrows the list to what you are looking at anyway. -->
    <VirtualList items={visiblePools} rowHeight={SECTION_HEADER_HEIGHT}>
      {#snippet row(pool)}
        {@render poolSection(pool)}
      {/snippet}
    </VirtualList>
  {:else}
    {#each visiblePools as pool (pool.id)}
      {@render poolSection(pool)}
    {/each}
  {/if}
{/if}

{#snippet poolSection(pool: AccountPool)}
  {@const poolAccounts = accountsFor(pool)}
  {@const open = isOpen(pool.id)}
  {@const status = statusFor(pool)}
  <section class="pool">
    <Card>
      <ItemBox
        columns={POOL_COLUMNS}
        testid={"pool-" + pool.id}
        title={pool.label}
        subtitle={laneIds(pool)}
        monoSubtitle
        openTarget="row"
        expanded={open}
        openLabel={`${open ? "Collapse" : "Expand"} ${pool.label}`}
        onOpen={() => setOpen(pool, !open)}
      >
        {#snippet icon()}
          <PluginIcon name={pool.label} kind="provider" size={LOGO_SIZE.list} />
        {/snippet}
        {#snippet actions()}
          <div><StatusPill variant={status.variant} label={status.label} title={status.detail} /></div>
          <div class="acct">{countLabel(open ? poolAccounts.length : pool.accountCount)}</div>
          <div onclick={(e) => e.stopPropagation()} role="presentation">
            <Button onclick={() => (addFor = { id: pool.controllerId, label: pool.label })} disabled={!!pool.error}>
              {pool.accountCount > 0 ? "Add another" : "Add account"}
            </Button>
          </div>
          <span class="chev" class:o={open}>&rsaquo;</span>
        {/snippet}
      </ItemBox>
    </Card>

    {#if open}
      <div class="body">
        {#if pool.error}
          <p class="error">{pool.providers[0].pluginName} failed to load, so these accounts cannot be managed: {pool.error}</p>
          <div class="grouptools"><Button onclick={() => retry(pool)}>Try again</Button></div>
        {:else if accountErrors[pool.id]}
          <p class="error">Could not load accounts for {pool.label}: {accountErrors[pool.id]}</p>
          <div class="grouptools"><Button onclick={() => retry(pool)}>Try again</Button></div>
        {:else if loadingAccounts[pool.id] && poolAccounts.length === 0}
          <div class="skeletons">
            {#each Array(Math.min(pool.accountCount || 1, 3)) as _}
              <Skeleton height="64px" radius="10px" />
            {/each}
          </div>
        {:else if poolAccounts.length === 0}
          <p class="empty">{searching ? "No accounts match your search." : "No accounts yet."}</p>
        {:else}
          <ItemList
            items={poolAccounts}
            key={(account) => account.id}
            rowHeight={ACCOUNT_ROW_HEIGHT}
            virtualizeAfter={VIRTUALIZE_THRESHOLD}
          >
            {#snippet item(account)}{@render accountRow(pool, account)}{/snippet}
          </ItemList>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet accountRow(pool: AccountPool, account: AccountView)}
  <AccountRow
    label={accountLabel(account)}
    detail={account.detail ?? ""}
    status={accountStatusInfo(account)}
    enabled={account.enabled}
    quota={account.quota ?? []}
    onToggle={(on) => handleToggle(pool, account.id, on)}
    onRemove={() => confirmRemove(pool, account)}
  />
{/snippet}

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

{#if addFor}
  <AddAccountDialog
    provider={addFor}
    onClose={() => (addFor = null)}
    onAdded={() => {
      const pool = pools.find((candidate) => candidate.controllerId === addFor?.id);
      addFor = null;
      if (pool) void loadAccounts(pool);
      void load();
    }}
  />
{/if}

<style>
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--space-md);
    margin-bottom: var(--space-2xl);
  }
  .pool {
    margin-bottom: var(--space-sm);
  }
  .body {
    margin: var(--space-sm) 0 var(--space-xl);
  }
  .acct {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .grouptools {
    display: flex;
    justify-content: flex-end;
  }
  .chev {
    font-size: var(--fs-lg);
    color: var(--faint);
    transform: rotate(0deg);
    transition: transform 150ms ease-out;
  }
  .chev.o {
    transform: rotate(90deg);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .picker {
    position: relative;
    flex: none;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    min-width: 180px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  /* The list is every installed provider, so it filters and scrolls rather than growing
     the menu past the window. */
  .menuscroll {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }
  .filter {
    font-family: var(--ui);
    font-size: 12px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    margin-bottom: 6px;
  }
  .filter:focus {
    outline: none;
    border-color: var(--accent);
  }
  .menu button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 12.5px;
    color: var(--text);
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .mlabel {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mcount {
    flex: none;
    font-size: 10.5px;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .mempty {
    margin: 0;
    padding: 7px 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .skeletons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .error {
    color: var(--crit);
    font-size: 13px;
  }
</style>
