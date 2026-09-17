<script lang="ts">
  import { onMount } from "svelte";
  import type { ActivityRecord } from "@forebay/shared";
  import { formatBytes, formatRate, formatDuration } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { rows, cancelRow, clearFinished, type DownloadRow } from "../downloads.js";
  import { groupHistory } from "../util/downloadHistory.js";
  import { humanizeId } from "../util/appLabel.js";
  import PageHeader from "../components/PageHeader.svelte";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import PluginIcon, { LOGO_SIZE } from "../components/PluginIcon.svelte";
  import { navigate } from "../router.js";
  import { whenLabel, exactTime } from "../util/time.js";
  import SpeedGraph from "../charts/SpeedGraph.svelte";

  const active = $derived($rows.filter((r) => r.status === "installing" || r.status === "cancelling"));
  const queued = $derived($rows.filter((r) => r.status === "pending"));
  // Work that succeeded is already described by its Recent row, so it leaves the screen when it
  // finishes. Work that failed or was cancelled gets no Recent row at all, so it stays up top
  // until it is cleared rather than vanishing unseen.
  const failures = $derived($rows.filter((r) => r.status === "failed" || r.status === "cancelled"));

  // History is whatever the activity log already recorded, so it survives a restart with no
  // storage of its own. Cleared entries are hidden here, never deleted from the log.
  let history = $state<ActivityRecord[]>([]);
  let hiddenBefore = $state(0);
  let now = $state(Date.now());

  let installed = $state<Set<string>>(new Set());
  let meta = $state<Record<string, { displayName: string; icon: string }>>({});
  let historyLoading = $state(true);

  async function loadInstalled(): Promise<void> {
    const result = await forebay.pluginsList();
    if (result.ok) {
      const rows = result.data.flatMap((section) => section.rows);
      installed = new Set(rows.map((row) => row.name));
      meta = Object.fromEntries(rows.map((row) => [row.name, { displayName: row.displayName ?? row.name, icon: row.icon ?? "" }]));
    }
    historyLoading = false;
  }

  function labelOf(plugin: string): string {
    return meta[plugin]?.displayName ?? plugin;
  }

  // A row is a way into the plugin, the same as clicking it in the plugins list.
  function openPlugin(plugin: string): void {
    navigate("plugins", { plugin }, { redirect: true });
  }

  async function loadHistory(): Promise<void> {
    const result = await forebay.activityRead({ topics: ["plugin.installed"], limit: 200 });
    if (result.ok) history = result.data.records;
  }

  onMount(() => {
    void loadInstalled();
    void loadHistory();
    const tick = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(tick);
  });

  // Reload history whenever live work finishes, so a completed job appears without a revisit.
  let lastLiveCount = $state(-1);
  $effect(() => {
    const live = active.length + queued.length;
    if (lastLiveCount > 0 && live === 0) {
      void loadInstalled();
      void loadHistory();
    }
    lastLiveCount = live;
  });

  function elapsed(row: DownloadRow): string {
    return formatDuration(Math.max(0, (row.endedAt ?? now) - (row.startedAt ?? row.queuedAt)));
  }

  const visibleHistory = $derived(groupHistory(history, { installed, hiddenBefore }));
  const hasAnything = $derived(historyLoading || active.length + queued.length + failures.length + visibleHistory.length > 0);
  const totalRate = $derived(active.reduce((sum, r) => sum + (r.bytesPerSecond ?? 0), 0));

  function clearAll(): void {
    clearFinished();
    hiddenBefore = Date.now();
  }
</script>

<PageHeader title="Downloads" subtitle="Plugin work Forebay is doing, queued, or has done">
  {#snippet actions()}
    {#if totalRate > 0}
      <span class="headrate" data-testid="total-rate">{formatRate(totalRate)}</span>
    {/if}
  {/snippet}
</PageHeader>

{#if !hasAnything}
  <EmptyState message="Nothing has been downloaded yet. Installing a plugin queues it here." />
{:else}
  <div class="stack">
  {#if failures.length > 0}
    <Card>
      <div class="pad">
        <h3 class="section">Did not finish <span class="count">{failures.length}</span></h3>
        <ul class="log">
          {#each failures as row (row.id)}
            <li class="job-row" data-testid="failed-row">
              <span class="dot" class:crit={row.status === "failed"} class:idle={row.status === "cancelled"}></span>
              <span class="what">{row.label}</span>
              <span class="took num">{elapsed(row)}</span>
              <span class="where"><span class="chip">{row.home}</span></span>
              <span class="why" title={row.error}>{row.error || "cancelled"}</span>
            </li>
          {/each}
        </ul>
      </div>
    </Card>
  {/if}

  {#if active.length > 0}
    {#each active as row (row.id)}
      <Card>
        <div class="pad job" data-testid="active-job">
          <div class="head">
            <div class="who">
              <span class="name">{row.label}</span>
              <span class="into">into</span>
              <span class="home">{row.home}</span>
            </div>
            <div class="act">
              <span class="clock">{elapsed(row)}</span>
              {#if row.cancellable}
                <Button variant="ghost" onclick={() => cancelRow(row)}>Cancel</Button>
              {:else if row.status === "cancelling"}
                <span class="cancelling">Cancelling…</span>
              {/if}
            </div>
          </div>

          <div class="meter">
            <div class="track">
              <!-- The width eases, so real progress reads as motion rather than as jumps. -->
              <span class="fill" class:indeterminate={row.percent < 0} style={row.percent >= 0 ? `width:${Math.max(2, row.percent)}%` : undefined}></span>
            </div>
            <span class="pct">{row.percent >= 0 ? `${row.percent}%` : "--"}</span>
          </div>

          <dl class="stats">
            <div><dt>Stage</dt><dd>{row.step || "starting"}</dd></div>
            {#if row.bytes !== undefined}
              <div><dt>Transferred</dt><dd class="num">{formatBytes(row.bytes)}</dd></div>
            {/if}
            {#if row.bytesPerSecond !== undefined}
              <div><dt>Rate</dt><dd class="num">{formatRate(row.bytesPerSecond)}</dd></div>
            {/if}
          </dl>

          {#if row.samples.length > 1}
            <SpeedGraph samples={row.samples} height={34} label={row.label} />
          {/if}

          {#if row.phases.length > 0}
            <ol class="trail">
              {#each row.phases as phase (phase.name)}
                <li><span class="pname">{phase.name}</span><span class="pms num">{formatDuration(phase.ms)}</span></li>
              {/each}
              <li class="running"><span class="pname">{row.step}</span><span class="pms num">running</span></li>
            </ol>
          {/if}
        </div>
      </Card>
    {/each}
  {/if}

  {#if queued.length > 0}
    <Card>
      <div class="pad">
      <h3 class="section">Queued <span class="count">{queued.length}</span></h3>
      <ol class="queue">
        {#each queued as row, index (row.id)}
          <li data-testid="queued-job">
            <span class="pos num">{index + 1}</span>
            <span class="name">{row.label}</span>
            <span class="home">{row.home}</span>
            <span class="grow"></span>
            <span class="waiting">waiting</span>
            {#if row.cancellable}
              <Button variant="ghost" onclick={() => cancelRow(row)}>Cancel</Button>
            {/if}
          </li>
        {/each}
      </ol>
      </div>
    </Card>
  {/if}

  {#if historyLoading}
    <Card>
      <div class="pad">
        <h3 class="section">Recent</h3>
        <Skeleton height="34px" radius="8px" lines={4} />
      </div>
    </Card>
  {:else if visibleHistory.length > 0}
    <Card>
      <div class="pad">
      <div class="sectionhead">
        <h3 class="section">Recent</h3>
        {#if failures.length > 0 || visibleHistory.length > 0}
          <Button variant="ghost" onclick={clearAll}>Clear history</Button>
        {/if}
      </div>
      <ul class="log">
        {#each visibleHistory as entry (entry.key)}
          <li data-testid="history-row" class:bad={entry.failed}>
            <button class="row" title={`View ${labelOf(entry.plugin)}`} onclick={() => openPlugin(entry.plugin)}>
            <span class="dot" class:crit={entry.failed}></span>
            <PluginIcon icon={meta[entry.plugin]?.icon} name={labelOf(entry.plugin)} size={LOGO_SIZE.compact} />
            <span class="what">{labelOf(entry.plugin)}</span>
            <span class="ver num">
              {#if entry.fromVersion}<span class="from">{entry.fromVersion}</span>{/if}
              {#if entry.toVersion}<span class="to">{entry.toVersion}</span>{/if}
            </span>
            {#if entry.failed && entry.error}
              <span class="why" title={entry.error}>{entry.error}</span>
            {:else}
              <span class="where">
                {#each entry.homes as home (home)}
                  <span class="chip">{humanizeId(home)}</span>
                {/each}
              </span>
            {/if}
            <span class="when num" title={exactTime(entry.ts)}>{whenLabel(entry.ts, now)}</span>
            </button>
          </li>
        {/each}
      </ul>
      </div>
    </Card>
  {/if}
  </div>
{/if}

<style>
  .pad {
    padding: 14px 18px;
  }
  /* The sections are separate cards, so they need air between them or they read as
     one run-on panel. :global because Card owns the element this lands on. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  /* The section's own actions sit on its title row, not the page header: they act on
     this section, and the page header is shared with every other download state. */
  .sectionhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .sectionhead .section {
    margin-bottom: 0;
  }
  .headrate {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    color: var(--accent);
  }

  /* Active job: an instrument panel, read top to bottom. */
  .job {
    display: grid;
    gap: 14px;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .who {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
  }
  .name {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .into {
    font-size: 11px;
    color: var(--faint);
  }
  .home {
    font-size: 11px;
    color: var(--muted);
    padding: 1px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    white-space: nowrap;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
  }
  .clock,
  .cancelling {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    color: var(--muted);
  }

  .meter {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .track {
    position: relative;
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, white));
    /* Progress arrives in real steps from git; easing turns them into movement. */
    transition: width 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .fill.indeterminate {
    width: 34%;
    animation: sweep 1.4s ease-in-out infinite;
    transition: none;
  }
  @keyframes sweep {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(320%); }
  }
  .pct {
    min-width: 42px;
    text-align: right;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    color: var(--text);
  }

  .stats {
    display: flex;
    gap: 26px;
    margin: 0;
  }
  .stats div {
    display: grid;
    gap: 2px;
  }
  dt {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faint);
  }
  dd {
    margin: 0;
    font-size: 12.5px;
    color: var(--text);
  }
  .num {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }

  .trail {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .trail li {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
  }
  .trail .pname {
    font-size: 11px;
    color: var(--muted);
  }
  .trail .pms {
    font-size: 10.5px;
    color: var(--faint);
  }
  .trail li.running {
    border-color: var(--accent-border);
    background: var(--accent-weak);
  }
  .trail li.running .pname {
    color: var(--accent);
  }

  .section {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--faint);
  }
  .count {
    font-family: var(--mono);
    color: var(--muted);
  }

  .queue {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .queue li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--border);
  }
  .queue li:first-child {
    border-top: none;
  }
  .pos {
    width: 18px;
    font-size: 11px;
    color: var(--faint);
  }
  .queue .name {
    font-size: 13px;
    font-weight: 500;
  }
  .grow {
    flex: 1;
  }
  .waiting {
    font-size: 11px;
    color: var(--faint);
  }

  /* One line per plugin: status, name, version and the homes it landed in, as a grid so the
     columns line up down the page and nothing is stranded against the far edge. */
  .log {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .log li {
    border-top: 1px solid var(--border);
  }
  .log li > .row {
    display: grid;
    /* The version cell sizes to its content but may shrink: a from/to pair of full
       SHAs is far wider than a tag, and a fixed track let it run under the next column. */
    grid-template-columns: 7px auto minmax(0, 13rem) minmax(0, auto) minmax(0, 1fr) 5.5rem;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 7px 8px;
    margin: 0 -8px;
    font-size: 12.5px;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    font-family: inherit;
    border-radius: 8px;
  }
  .log li > .row {
    cursor: pointer;
  }
  .log li > .row:hover {
    background: var(--surface-2);
  }
  /* A row for this session's own work has no plugin mark, so it keeps the narrower grid. */
  .log li.job-row {
    display: grid;
    grid-template-columns: 7px minmax(0, 13rem) 7.5rem auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 7px 0;
    font-size: 12.5px;
  }
  .log li:first-child {
    border-top: none;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--good);
  }
  .dot.crit {
    background: var(--crit);
  }
  .dot.idle {
    background: var(--faint);
  }
  .what {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ver,
  .took,
  .when {
    font-size: 11px;
    color: var(--faint);
    white-space: nowrap;
  }
  .ver {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when {
    text-align: right;
  }
  .ver .from::after {
    content: " to ";
    margin: 0 4px;
    color: var(--border-strong);
  }
  .ver .to {
    color: var(--muted);
  }
  .where {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }
  .chip {
    padding: 1px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .why {
    color: var(--crit);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
