<script lang="ts">
  import { downloads, toggleDownloads, closeDownloads, cancelRow, type DownloadRow } from "../downloads.js";
  import { navigate } from "../router.js";
  import { formatRate } from "@forebay/shared";

  const LIVE = ["pending", "installing", "cancelling"];
  const inFlight = $derived($downloads.tasks.filter((t) => LIVE.includes(t.status)).length);

  let root = $state<HTMLElement | null>(null);
  function onWindowClick(e: MouseEvent): void {
    if ($downloads.open && root && !root.contains(e.target as Node)) closeDownloads();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") closeDownloads();
  }

  function progressLine(task: DownloadRow): string {
    if (task.status === "pending") return "Queued";
    if (task.status === "cancelling") return "Cancelling…";
    if (task.status === "installing") return task.step || "Working…";
    if (task.status === "done") return "Done";
    if (task.status === "cancelled") return "Cancelled";
    return task.error || "Failed";
  }

  // Aggregate progress of everything in flight drives the ring; a pending or
  // not-yet-reported task counts as 0 so the ring only fills as work completes.
  const active = $derived($downloads.tasks.filter((t) => LIVE.includes(t.status)));
  const MAX_GLANCE = 4;
  const glance = $derived(active.slice(0, MAX_GLANCE));

  function openDownloads(): void {
    closeDownloads();
    navigate("downloads");
  }
  const aggregate = $derived(active.length ? active.reduce((sum, t) => sum + Math.max(t.percent, 0), 0) / active.length : 0);
  const RING = 2 * Math.PI * 12;
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<div class="downloadmgr" bind:this={root}>
  {#if inFlight > 0}
    <button class="iconbtn" title="Downloads" aria-label="Toggle download manager" onclick={toggleDownloads}>
      {#if inFlight > 0}
        <svg class="ring" viewBox="0 0 28 28" aria-hidden="true">
          <circle class="ringtrack" cx="14" cy="14" r="12" />
          <circle
            class="ringfill"
            cx="14"
            cy="14"
            r="12"
            stroke-dasharray={RING}
            stroke-dashoffset={RING * (1 - aggregate / 100)}
          />
        </svg>
      {/if}
      <svg class="downloadicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {#if inFlight > 0}<span class="badge">{inFlight}</span>{/if}
    </button>
  {/if}
  {#if $downloads.open && glance.length > 0}
    <!-- a glance at what is live, with the screen one click away -->
    <div class="panel">
      <div class="panelhead">
        <span class="title">Downloads</span>
        <button class="clearbtn" onclick={openDownloads}>View all</button>
      </div>
      {#each glance as task (task.id)}
        <div class="task status-{task.status}">
          <div class="row">
            <span class="label" title={task.label}>{task.label}</span>
            {#if task.cancellable}
              <button class="cancelbtn" onclick={() => cancelRow(task)}>Cancel</button>
            {:else}
              <span class="statedot" aria-hidden="true"></span>
            {/if}
          </div>
          <div class="meta">
            <span class="home">{task.home}</span>
            <span class="metagrow"></span>
            {#if task.bytesPerSecond !== undefined}
              <span class="rate" data-testid="glance-rate">{formatRate(task.bytesPerSecond)}</span>
            {/if}
            {#if task.percent >= 0}<span class="pct">{task.percent}%</span>{/if}
          </div>
          {#if task.status === "installing"}
            {#if task.percent >= 0}
              <div class="bar"><span class="fill det" style={`width:${Math.max(4, task.percent)}%`}></span></div>
            {:else}
              <div class="bar"><span class="fill"></span></div>
            {/if}
          {/if}
          <div class="progress">{progressLine(task)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .downloadmgr {
    position: relative;
    -webkit-app-region: no-drag;
  }
  .iconbtn {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
    -webkit-app-region: no-drag;
  }
  .downloadicon {
    width: 14px;
    height: 14px;
  }
  .ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
    pointer-events: none;
  }
  .ringtrack {
    fill: none;
    stroke: var(--border);
    stroke-width: 2;
  }
  .ringfill {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.25s ease;
  }
  .iconbtn:hover {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
  }
  .iconbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--surface);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 14px;
    text-align: center;
  }
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 300px;
    max-height: 360px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    z-index: 50;
    padding: 6px;
    -webkit-app-region: no-drag;
  }
  .panelhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px 6px;
  }
  .panelhead .title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .02em;
    color: var(--faint);
    text-transform: uppercase;
  }
  .clearbtn {
    all: unset;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
  .clearbtn:hover {
    color: var(--text);
  }
  .clearbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .task {
    padding: 8px;
    border-radius: 7px;
  }
  .task:hover {
    background: var(--surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .statedot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
  }
  .status-pending .statedot {
    background: var(--faint);
  }
  .status-installing .statedot {
    background: var(--accent);
  }
  .status-done .statedot {
    background: var(--good);
  }
  .status-failed .statedot {
    background: var(--crit);
  }
  .meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 3px;
  }
  .metagrow {
    flex: 1;
  }
  .rate,
  .pct {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 10.5px;
  }
  .rate {
    color: var(--accent);
  }
  .pct {
    color: var(--muted);
  }
  /* Was an unstyled button crowding the row; now a quiet affordance that only darkens on hover. */
  .cancelbtn {
    flex: none;
    padding: 1px 7px;
    font-size: 10.5px;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
  }
  .cancelbtn:hover {
    color: var(--crit);
    border-color: var(--crit);
  }
  .home {
    font-size: 11px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 0;
  }
  .src {
    flex: none;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: .02em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 5px;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .src-forebay {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .bar {
    margin-top: 6px;
    height: 3px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    width: 40%;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    animation: slide 1.1s ease-in-out infinite;
  }
  .fill.det {
    animation: none;
    /* Matches the Downloads screen: real steps, eased into movement. */
    transition: width 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(320%); }
  }
  .progress {
    margin-top: 4px;
    font-size: 11px;
    color: var(--muted);
  }
  .status-failed .progress {
    color: var(--crit);
  }
  .status-done .progress {
    color: var(--good);
  }
</style>
