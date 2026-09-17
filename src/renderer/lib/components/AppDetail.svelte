<script lang="ts">
  import type { HostApp, AppSummary, AppConnection } from "@forebay/shared";
  import Button from "./Button.svelte";
  import Chip from "./Chip.svelte";
  import Spinner from "./Spinner.svelte";
  import StatusPill from "./StatusPill.svelte";
  import RepoDetail from "./RepoDetail.svelte";
  import AppStorageSection from "./AppStorageSection.svelte";
  import { navigate } from "../router.js";

  const PROVIDER_BREAKDOWN_CAP = 6;

  let {
    app,
    summary,
    summaryError,
    connection,
    busy,
    canImport,
    onClose,
    onImport,
    onPrimary,
    onUninstall,
  }: {
    app: HostApp;
    summary: AppSummary | null;
    summaryError: string;
    connection: AppConnection | null;
    busy: boolean;
    canImport: boolean;
    onClose: () => void;
    onImport: () => void;
    onPrimary: () => void;
    onUninstall: (wipe: boolean) => void;
  } = $props();

  let confirmingUninstall = $state(false);
  let wipe = $state(false);

  // The repo behind an app is its loader; the detail surfaces the loader's stars
  // and readme while the Status tab covers the app's own connection.
  const repo = $derived({
    name: connection?.loaderId ?? app.id,
    url: connection?.loaderUrl ?? "",
    displayName: app.label,
    icon: app.icon,
  });

  const connected = $derived(
    !!connection && connection.cliPresent && (connection.loaderId ? connection.loaderInstalled : true),
  );
  const statusLabel = $derived(connected ? "Connected" : connection?.cliPresent ? "Loader not installed" : "Not detected");

  const shownBreakdown = $derived(summary ? summary.providerBreakdown.slice(0, PROVIDER_BREAKDOWN_CAP) : []);
  const moreCount = $derived(summary ? summary.providerBreakdown.length - shownBreakdown.length : 0);

  function openLocalApi(): void {
    onClose();
    navigate("localApi");
  }
</script>

{#snippet content(active: string)}
  {#if active === "status"}
    <div class="status">
      <div class="statusline">
        <StatusPill variant={connected ? "good" : "off"} label={statusLabel} />
      </div>

      <section>
        <p class="label">Integration</p>
        <div class="chainrows">
          <div class="chainrow">
            <span class="cdot" class:on={connection?.cliPresent}></span>
            <span class="ck">Command line</span>
            <span class="cs">{connection?.cliPresent ? "Installed" : "Not installed"}</span>
            {#if connection && !connection.cliPresent && !connection.loaderId}
              <Button variant="primary" disabled={busy} onclick={onPrimary}>
                {#if busy}<Spinner />{/if}
                Install CLI
              </Button>
            {/if}
          </div>

          {#if connection?.loaderId}
            <div class="chainrow">
              <span class="cdot" class:on={connection?.loaderInstalled}></span>
              <span class="ck">Loader</span>
              <span class="cs">{connection?.loaderInstalled ? "Installed" : "Not installed"}</span>
              {#if !connection?.loaderInstalled}
                <Button variant="primary" disabled={busy} onclick={onPrimary}>
                  {#if busy}<Spinner />{/if}
                  {connection?.cliPresent ? "Install loader" : "Connect"}
                </Button>
              {/if}
            </div>
          {/if}
        </div>
        <button class="altlink" onclick={openLocalApi}>
          Prefer not to use the loader? Connect this app through the Local API →
        </button>
      </section>

      {#if summaryError}
        <p class="error">Could not load app summary: {summaryError}</p>
      {:else if summary}
        <section>
          <p class="label">Snapshot</p>
          <div class="stats">
            <div class="stat" data-testid="stat-accounts"><span class="v">{summary.accounts.length}</span><span class="k">accounts</span></div>
            <div class="stat" data-testid="stat-enabled"><span class="v">{summary.accountsEnabled}</span><span class="k">enabled</span></div>
            <div class="stat" data-testid="stat-providers"><span class="v">{summary.providerCount}</span><span class="k">providers</span></div>
            <div class="stat" data-testid="stat-plugins"><span class="v">{summary.pluginCount}</span><span class="k">plugins</span></div>
            {#if summary.routingSlots !== null}
              <div class="stat" data-testid="stat-routing"><span class="v">{summary.routingSlots}</span><span class="k">routing slots</span></div>
            {/if}
            {#if summary.quotaMinPct !== null}
              <div class="stat" data-testid="stat-quota"><span class="v">{summary.quotaMinPct}%</span><span class="k">lowest quota</span></div>
            {/if}
          </div>
        </section>

        <section>
          <p class="label">Providers</p>
          {#if shownBreakdown.length > 0}
            <div class="breakdown">
              {#each shownBreakdown as agg}
                <Chip label={`${agg.provider} · ${agg.enabled}/${agg.accounts}`} />
              {/each}
              {#if moreCount > 0}<span class="more">+{moreCount} more</span>{/if}
            </div>
          {:else}
            <p class="muted">No accounts connected.</p>
          {/if}
        </section>

        <AppStorageSection app={app.id} />
      {:else}
        <p class="muted">Loading summary…</p>
      {/if}

      {#if canImport}
        <div class="rowactions">
          <Button onclick={onImport}>Import config</Button>
        </div>
      {/if}

      <section class="dangerzone">
        {#if !confirmingUninstall}
          <Button variant="danger" onclick={() => { confirmingUninstall = true; wipe = false; }}>Uninstall app</Button>
        {:else}
          <div class="dangerpanel">
            <p>This removes the {app.label} CLI from this machine. Plugins and configuration stay in place unless you also delete data.</p>
            <label class="wipe">
              <input type="checkbox" checked={wipe} onchange={(event) => (wipe = event.currentTarget.checked)} />
              Also delete all data
            </label>
            <div class="rowactions end">
              <Button onclick={() => (confirmingUninstall = false)}>Cancel</Button>
              <Button variant="danger" onclick={() => onUninstall(wipe)}>Uninstall</Button>
            </div>
          </div>
        {/if}
      </section>
    </div>
  {/if}
{/snippet}

<RepoDetail {repo} {onClose} tabs={[{ id: "status", label: "Status" }]} tabContent={content} defaultTab="status" />

<style>
  .status {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .statusline {
    display: flex;
  }
  .label {
    margin: 0 0 8px;
    font-size: 10.5px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
  }
  .chainrows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .chainrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
  }
  .cdot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-strong);
    flex: none;
  }
  .cdot.on {
    background: var(--good);
  }
  .ck {
    font-size: 12.5px;
    font-weight: 600;
  }
  .cs {
    font-size: 11px;
    color: var(--muted);
    margin-left: auto;
  }
  .altlink {
    margin-top: 8px;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    font-size: 11.5px;
    color: var(--accent);
    cursor: pointer;
  }
  .altlink:hover {
    text-decoration: underline;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 8px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
  }
  .stat .v {
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -.02em;
    font-variant-numeric: tabular-nums;
  }
  .stat .k {
    font-size: 10.5px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
  }
  .breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .more {
    font-size: 11.5px;
    color: var(--faint);
    padding: 4px 10px;
  }
  .muted {
    margin: 0;
    color: var(--faint);
    font-size: 12.5px;
  }
  .error {
    color: var(--crit);
    font-size: 12.5px;
    margin: 0;
  }
  .rowactions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .rowactions.end {
    justify-content: flex-end;
  }
  .dangerzone {
    padding-top: 4px;
  }
  .dangerpanel {
    padding: 16px 18px;
    border: 1px solid var(--crit);
    border-radius: var(--radius);
    background: var(--crit-weak);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dangerpanel p {
    margin: 0;
    font-size: 12.5px;
    color: var(--text);
  }
  .wipe {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text);
    cursor: pointer;
  }
</style>
