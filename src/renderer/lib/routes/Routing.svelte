<script lang="ts">
  import { onMount } from "svelte";
  import type { Chain, ModelCatalogEntry, RoutingApp } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import { navigate } from "../router.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import ConfirmDialog from "../components/ConfirmDialog.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import EmptyState from "../components/EmptyState.svelte";

  let apps = $state<RoutingApp[]>([]);
  let app = $state("");
  let tiers = $state<string[]>([]);
  let map = $state<Record<string, Chain>>({ default: [] });
  let catalog = $state<ModelCatalogEntry[]>([]);
  let loadError = $state("");
  let warnings = $state<string[]>([]);
  let loaded = $state(false);
  let pending = $state<Record<string, string>>({});
  let pendingConfirm = $state<{ title: string; message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);

  const slots = $derived(["default", ...tiers]);

  function catalogKey(entry: ModelCatalogEntry): string {
    return `${entry.provider}|${entry.model}`;
  }

  function parseKey(key: string): { provider: string; model: string } | null {
    const [provider, model] = key.split("|");
    return provider && model ? { provider, model } : null;
  }

  async function load(): Promise<void> {
    const result = await forebay.routingGet(app);
    if (result.ok) {
      tiers = result.data.tiers;
      map = result.data.map;
      catalog = result.data.catalog;
      loadError = "";
    } else {
      loadError = result.error;
    }
  }

  async function switchApp(next: string): Promise<void> {
    app = next;
    warnings = [];
    await load();
  }

  async function setChain(slot: string, chain: { provider: string; model: string }[]): Promise<void> {
    const result = await forebay.routingSetChain(app, slot, chain);
    if (!result.ok) {
      toast.error(result.error);
    } else {
      warnings = result.data.warnings;
    }
    await load();
  }

  async function addAssignment(slot: string): Promise<void> {
    const parsed = pending[slot] ? parseKey(pending[slot]) : null;
    if (!parsed) return;
    const chain = [...(map[slot] ?? []).map(({ provider, model }) => ({ provider, model })), parsed];
    pending[slot] = "";
    await setChain(slot, chain);
  }

  async function removeAssignment(slot: string, index: number): Promise<void> {
    const chain = (map[slot] ?? [])
      .filter((_, i) => i !== index)
      .map(({ provider, model }) => ({ provider, model }));
    await setChain(slot, chain);
  }

  async function moveAssignment(slot: string, index: number, delta: -1 | 1): Promise<void> {
    const current = (map[slot] ?? []).map(({ provider, model }) => ({ provider, model }));
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    await setChain(slot, current);
  }

  function confirmRemoveAssignment(slot: string, index: number): void {
    pendingConfirm = {
      title: "Remove routing step?",
      message: "Remove this routing step from the chain?",
      confirmLabel: "Remove",
      run: () => removeAssignment(slot, index),
    };
  }

  onMount(async () => {
    const result = await forebay.routingApps();
    if (result.ok) {
      apps = result.data;
      app = result.data[0]?.app ?? "";
      if (app) await load();
    }
    loaded = true;
  });
</script>

<div class="head">
  <div>
    <h1>Routing</h1>
    <p>Assign a provider/model chain to each tier. The proxy falls through to the next entry when one is rate-limited.</p>
  </div>
</div>

{#if !loaded}
  <div class="skeletons">
    <Skeleton width="220px" height="30px" />
    {#each Array(4) as _}
      <Skeleton height="46px" radius="10px" />
    {/each}
  </div>
{:else if apps.length === 0}
  <EmptyState
    message="Install a proxy in Plugins to configure routing."
    actionLabel="Browse proxies"
    onAction={() => navigate("plugins", { kind: "proxy" }, { redirect: true })}
  />
{:else}
  {#if apps.length > 1}
    <div class="apptabs">
      {#each apps as a (a.app)}
        <button class:active={a.app === app} onclick={() => switchApp(a.app)}>{a.label}</button>
      {/each}
    </div>
  {/if}

  {#if loadError}
    <ErrorState message={`Could not load routing: ${loadError}`} onRetry={load} />
  {:else}
    {#if warnings.length > 0}
      <div class="warnings">
        {#each warnings as warning}
          <p>{warning}</p>
        {/each}
      </div>
    {/if}
    {#each slots as slot (slot)}
    <section class="group">
      <div class="grouphead">
        <p class="label">{slot}</p>
        <span class="count">{(map[slot] ?? []).length}</span>
        <span class="line"></span>
      </div>
      <Card>
        <div class="slot">
          {#each map[slot] ?? [] as assignment, index (index)}
            <div class="chain-row">
              <span class="model">{assignment.name ?? assignment.model}</span>
              <span class="provider">{assignment.provider}</span>
              {#if assignment.derived}<span class="derived">auto</span>{/if}
              <div class="reorder">
                <button
                  class="mv"
                  aria-label={`Move ${assignment.name ?? assignment.model} up (position ${index + 1})`}
                  disabled={index === 0}
                  onclick={() => moveAssignment(slot, index, -1)}
                >▲</button>
                <button
                  class="mv"
                  aria-label={`Move ${assignment.name ?? assignment.model} down (position ${index + 1})`}
                  disabled={index === (map[slot] ?? []).length - 1}
                  onclick={() => moveAssignment(slot, index, 1)}
                >▼</button>
              </div>
              <Button onclick={() => confirmRemoveAssignment(slot, index)}>Remove</Button>
            </div>
          {:else}
            <p class="empty">No chain assigned</p>
          {/each}
          <div class="add-row">
            <select bind:value={pending[slot]} aria-label={`Add model to ${slot}`}>
              <option value="">Add model...</option>
              {#each catalog as entry (catalogKey(entry))}
                <option value={catalogKey(entry)}>{entry.provider} / {entry.name ?? entry.model}</option>
              {/each}
            </select>
            <Button onclick={() => addAssignment(slot)}>Add</Button>
          </div>
        </div>
      </Card>
    </section>
    {/each}
  {/if}
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
  .group {
    margin-bottom: 26px;
  }
  .grouphead {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 2px 10px;
  }
  .grouphead .label {
    font-size: 10.5px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
    margin: 0;
  }
  .grouphead .count {
    font-size: 11px;
    color: var(--faint);
    font-family: var(--mono);
  }
  .grouphead .line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .slot {
    padding: 10px 16px;
  }
  .chain-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .chain-row:first-child {
    border-top: 0;
  }
  .chain-row .model {
    font-weight: 600;
    font-size: 13px;
  }
  .chain-row .provider {
    color: var(--faint);
    font-size: 11.5px;
    font-family: var(--mono);
  }
  .chain-row .derived {
    font-size: 10px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--faint);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 5px;
  }
  .reorder {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .mv {
    background: none;
    border: none;
    color: var(--faint);
    font-size: 11px;
    line-height: 1;
    padding: 4px;
    cursor: pointer;
  }
  .mv:disabled {
    opacity: .35;
    cursor: default;
  }
  .empty {
    color: var(--faint);
    font-size: 12.5px;
    padding: 8px 0;
    margin: 0;
  }
  .add-row {
    display: flex;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .add-row select {
    flex: 1;
    font-family: var(--ui);
    font-size: 12.5px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 7px 10px;
  }
  .apptabs {
    display: flex;
    gap: 6px;
    margin-bottom: 18px;
  }
  .apptabs button {
    font-family: var(--ui);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    border-radius: 8px;
    padding: 7px 12px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--faint);
  }
  .apptabs button.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .warnings {
    margin-bottom: 16px;
  }
  .warnings p {
    color: var(--crit);
    font-size: 12.5px;
    margin: 0 0 4px;
  }
</style>
