<script lang="ts">
  import { onMount } from "svelte";
  import type { OverviewSummary, UsageSnapshot, UsageSession } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { humanizeId } from "../util/appLabel.js";
  import { navigate } from "../router.js";
  import StatCard from "../components/StatCard.svelte";
  import Card from "../components/Card.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import AreaChart from "../charts/AreaChart.svelte";
  import { dayRange, dayKey, SERIES_COLORS, type SeriesInput } from "../charts/chartMath.js";

  const DAY_MS = 86_400_000;

  let summary = $state<OverviewSummary | null>(null);
  let snapshot = $state<UsageSnapshot | null>(null);
  let loadError = $state("");

  function sessionTokens(session: UsageSession): number {
    return session.tokens.input + session.tokens.output + session.tokens.reasoning;
  }

  const sessions = $derived(snapshot?.sessions ?? []);
  const todayKey = $derived(dayKey(Date.now()));
  const todayTokens = $derived(sessions.reduce((sum, s) => sum + (s.costByDay[todayKey]?.tokens ?? 0), 0));

  const sparkColumns = $derived(dayRange(Date.now() - 13 * DAY_MS, Date.now()));
  const sparkSeries = $derived.by<SeriesInput[]>(() => {
    const input = new Array(sparkColumns.length).fill(0);
    const output = new Array(sparkColumns.length).fill(0);
    const reasoning = new Array(sparkColumns.length).fill(0);
    const index = new Map(sparkColumns.map((c, i) => [c, i]));
    for (const session of sessions) {
      for (const [day, usage] of Object.entries(session.costByDay)) {
        const i = index.get(day);
        if (i === undefined) continue;
        input[i] += usage.tokensInput;
        output[i] += usage.tokensOutput;
        reasoning[i] += usage.tokensReasoning;
      }
    }
    const all = [
      { key: "input", color: SERIES_COLORS.input, values: input },
      { key: "output", color: SERIES_COLORS.output, values: output },
      { key: "reasoning", color: SERIES_COLORS.reasoning, values: reasoning },
    ];
    return all.filter((s) => s.values.some((v) => v > 0));
  });
  const hasSparkData = $derived(sparkSeries.some((s) => s.values.some((v) => v > 0)));

  const recentSessions = $derived([...sessions].sort((a, b) => b.updated - a.updated).slice(0, 5));
  const providerHealth = $derived(summary?.providerHealth.slice(0, 6) ?? []);

  function sourceLabel(source: UsageSession["source"]): string {
    return humanizeId(source);
  }

  function formatTokens(value: number): string {
    return value.toLocaleString("en-US");
  }

  async function load(): Promise<void> {
    const summaryResult = await forebay.overviewSummary();
    if (summaryResult.ok) {
      summary = summaryResult.data;
      loadError = "";
    } else {
      loadError = summaryResult.error;
    }

    const usageResult = await forebay.usageSnapshot();
    if (usageResult.ok) snapshot = usageResult.data;
  }

  onMount(load);
</script>

<div class="head">
  <div>
    <h1>Overview</h1>
    <p>Providers, accounts, local API, and recent activity.</p>
  </div>
</div>

{#if loadError}
  <ErrorState message={`Could not load the overview: ${loadError}`} onRetry={load} />
{:else if summary}
  <section class="summary">
    <StatCard label="Providers connected" value={String(summary.providersConnected)} />
    <StatCard label="Accounts" value={String(summary.accountsEnabled)} meta={`${summary.accountsTotal} total`} />
    <StatCard
      label="Local API"
      value={summary.serverRunning ? "Running" : "Stopped"}
      meta={`Port ${summary.serverPort}`}
      metaColor={summary.serverRunning ? "var(--good)" : "var(--faint)"}
    />
    <StatCard label="Apps detected" value={String(summary.appsDetected)} />
    <StatCard label="Plugins installed" value={String(summary.pluginsInstalled)} />
    <StatCard label="Today's tokens" value={formatTokens(todayTokens)} />
  </section>

  <section class="panel">
    <div class="phead">
      <p class="ptitle">Tokens, last 14 days</p>
      <button class="link" onclick={() => navigate("usage", undefined, { redirect: true })}>Usage →</button>
    </div>
    <Card>
      <div class="pad">
        {#if hasSparkData}
          <AreaChart columns={sparkColumns} series={sparkSeries} height={120} />
        {:else}
          <p class="empty">No usage recorded in the last 14 days</p>
        {/if}
      </div>
    </Card>
  </section>

  <div class="cols">
    <section class="panel">
      <div class="phead">
        <p class="ptitle">Providers</p>
        <button class="link" onclick={() => navigate("providers", undefined, { redirect: true })}>Providers →</button>
      </div>
      <Card>
        <div class="list">
          {#each providerHealth as health (health.provider)}
            <div class="row-line">
              <span class="primary">{health.provider}</span>
              <span class="meta">{health.accounts} account{health.accounts === 1 ? "" : "s"} · {health.quotaMinPct === null ? "quota n/a" : `${health.quotaMinPct}% left`}</span>
            </div>
          {:else}
            <p class="empty">No providers connected</p>
          {/each}
        </div>
      </Card>
    </section>

    <section class="panel">
      <div class="phead">
        <p class="ptitle">Recent sessions</p>
        <button class="link" onclick={() => navigate("usage", undefined, { redirect: true })}>Usage →</button>
      </div>
      <Card>
        <div class="list">
          {#each recentSessions as session (session.id)}
            <div class="row-line">
              <span class="primary" title={session.title}>{session.title}</span>
              <span class="meta">{sourceLabel(session.source)} · {formatTokens(sessionTokens(session))} tokens</span>
            </div>
          {:else}
            <p class="empty">No sessions yet</p>
          {/each}
        </div>
      </Card>
    </section>
  </div>
{:else}
  <div class="skeletons">
    <Skeleton height="72px" radius="12px" />
    <Skeleton height="140px" radius="12px" />
    <Skeleton height="140px" radius="12px" />
  </div>
{/if}

<style>
  .head {
    margin-bottom: 16px;
  }
  .head h1 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -.02em;
    font-weight: 650;
  }
  .head p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr));
    gap: 12px;
    margin-bottom: 22px;
  }
  .panel {
    margin-bottom: 22px;
  }
  .phead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 2px 10px;
  }
  .ptitle {
    font-size: 10.5px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
    margin: 0;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    font-family: var(--ui);
    font-size: 11.5px;
    cursor: pointer;
    padding: 0;
  }
  .pad {
    padding: 14px 16px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 16px;
  }
  .list {
    padding: 4px 16px;
  }
  .row-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--border);
  }
  .row-line:first-child {
    border-top: 0;
  }
  .row-line .primary {
    font-weight: 600;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-line .meta {
    color: var(--faint);
    font-size: 11.5px;
    font-family: var(--mono);
    white-space: nowrap;
    flex: none;
  }
  .empty {
    color: var(--faint);
    font-size: 12.5px;
    padding: 14px 4px;
    margin: 0;
  }
</style>
