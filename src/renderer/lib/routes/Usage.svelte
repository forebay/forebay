<script lang="ts">
  import { onMount } from "svelte";
  import type { UsageSnapshot, UsageSession } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { humanizeId } from "../util/appLabel.js";
  import { formatUsd } from "../util/format.js";
  import StatCard from "../components/StatCard.svelte";
  import Card from "../components/Card.svelte";
  import SearchField from "../components/SearchField.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import AreaChart from "../charts/AreaChart.svelte";
  import BarChart from "../charts/BarChart.svelte";
  import Donut from "../charts/Donut.svelte";
  import { dayRange, dayKey, paletteColor, SERIES_COLORS, type SeriesInput, type SliceInput, type BarInput } from "../charts/chartMath.js";

  type Range = "7d" | "30d" | "all";
  type SortKey = "updated" | "tokens" | "messages";
  const PAGE_SIZE = 25;
  const DAY_MS = 86_400_000;

  let snapshot = $state<UsageSnapshot | null>(null);
  let loadError = $state("");
  let range = $state<Range>("7d");
  let modelFilter = $state<string | null>(null);
  let providerHighlight = $state<string | null>(null);
  let query = $state("");
  let sortKey = $state<SortKey>("updated");
  let sortDesc = $state(true);
  let page = $state(0);

  const cutoff = $derived(range === "all" ? 0 : Date.now() - (range === "7d" ? 7 : 30) * DAY_MS);
  // A session is attributed to its last-updated day for range membership, even though its tokens can span several days.
  const inRange = $derived((snapshot?.sessions ?? []).filter((s) => s.updated >= cutoff));

  function sessionTokens(session: UsageSession): number {
    return session.tokens.input + session.tokens.output + session.tokens.reasoning;
  }

  const totalTokens = $derived(inRange.reduce((sum, s) => sum + sessionTokens(s), 0));

  const areaColumns = $derived.by(() => {
    if (inRange.length === 0) return [];
    if (range !== "all") return dayRange(cutoff, Date.now());
    const earliest = Math.min(...inRange.map((s) => s.updated));
    return dayRange(earliest, Date.now());
  });

  const areaSeries = $derived.by<SeriesInput[]>(() => {
    const input = new Array(areaColumns.length).fill(0);
    const output = new Array(areaColumns.length).fill(0);
    const reasoning = new Array(areaColumns.length).fill(0);
    const index = new Map(areaColumns.map((c, i) => [c, i]));
    for (const session of inRange) {
      for (const [day, usage] of Object.entries(session.costByDay)) {
        const i = index.get(day);
        if (i === undefined) continue;
        input[i] += usage.tokensInput;
        output[i] += usage.tokensOutput;
        reasoning[i] += usage.tokensReasoning;
      }
    }
    return [
      { key: "input", color: SERIES_COLORS.input, values: input },
      { key: "output", color: SERIES_COLORS.output, values: output },
      { key: "reasoning", color: SERIES_COLORS.reasoning, values: reasoning },
    ];
  });

  const modelBars = $derived.by<BarInput[]>(() => {
    const byModel = new Map<string, { tokens: number; provider: string }>();
    for (const session of inRange) {
      for (const model of session.models) {
        const entry = byModel.get(model.id) ?? { tokens: 0, provider: model.provider };
        entry.tokens += model.tokens;
        byModel.set(model.id, entry);
      }
    }
    return Array.from(byModel.entries()).map(([id, e]) => {
      const priced = snapshot?.models[id];
      const meta = priced?.priced && priced.estimatedCostUsd !== undefined ? `${e.provider} · ${formatUsd(priced.estimatedCostUsd)}` : e.provider;
      return { label: id, value: e.tokens, meta };
    });
  });

  const costAvailable = $derived((snapshot?.pricedModels ?? 0) > 0 && (snapshot?.estimatedCostUsd ?? 0) > 0);

  const costFootnote = $derived.by(() => {
    if (!snapshot) return "";
    const asOf = snapshot.pricesUpdatedAt ? ` (as of ${snapshot.pricesUpdatedAt})` : "";
    const unpriced = snapshot.unpricedModels ? `; ${snapshot.unpricedModels} model(s) unpriced` : "";
    return `All-time estimate at list prices${asOf}${unpriced}.`;
  });

  const providerSlices = $derived.by<SliceInput[]>(() => {
    const byProvider = new Map<string, number>();
    for (const session of inRange) {
      for (const model of session.models) byProvider.set(model.provider, (byProvider.get(model.provider) ?? 0) + model.tokens);
    }
    return Array.from(byProvider.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([provider, tokens], i) => ({ label: provider, value: tokens, color: paletteColor(i) }));
  });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return inRange.filter((session) => {
      if (modelFilter && !session.models.some((m) => m.id === modelFilter)) return false;
      if (!q) return true;
      const haystack = [session.title, session.project ?? "", sourceLabel(session.source), ...session.models.map((m) => m.id)].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  });

  const sorted = $derived.by(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const av = sortKey === "updated" ? a.updated : sortKey === "tokens" ? sessionTokens(a) : a.messageCount;
      const bv = sortKey === "updated" ? b.updated : sortKey === "tokens" ? sessionTokens(b) : b.messageCount;
      return sortDesc ? bv - av : av - bv;
    });
    return rows;
  });

  const pageCount = $derived(Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)));
  const pageRows = $derived(sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE));

  $effect(() => {
    // Reset paging whenever the effective row set changes.
    void range;
    void query;
    void modelFilter;
    void sortKey;
    void sortDesc;
    page = 0;
  });

  function setSort(key: SortKey): void {
    if (sortKey === key) sortDesc = !sortDesc;
    else {
      sortKey = key;
      sortDesc = true;
    }
  }

  function toggleModel(label: string): void {
    modelFilter = modelFilter === label ? null : label;
  }

  function toggleProvider(label: string): void {
    providerHighlight = providerHighlight === label ? null : label;
  }

  function sourceLabel(source: UsageSession["source"]): string {
    return humanizeId(source);
  }

  function modelList(session: UsageSession): string {
    return session.models.map((m) => m.id).join(", ") || "n/a";
  }

  function formatTokens(value: number): string {
    return value.toLocaleString("en-US");
  }

  function formatUpdated(value: number): string {
    if (!value) return "n/a";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "n/a" : dayKey(value);
  }

  function sortArrow(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDesc ? " ↓" : " ↑";
  }

  async function load(): Promise<void> {
    const result = await forebay.usageSnapshot();
    if (result.ok) {
      snapshot = result.data;
      loadError = "";
    } else {
      loadError = result.error;
    }
  }

  onMount(load);
</script>

<div class="head">
  <div>
    <h1>Usage</h1>
    <p>Token activity across providers, models, and sessions.</p>
  </div>
  <div class="ranges" role="group" aria-label="Time range">
    <button class:active={range === "7d"} onclick={() => (range = "7d")}>7d</button>
    <button class:active={range === "30d"} onclick={() => (range = "30d")}>30d</button>
    <button class:active={range === "all"} onclick={() => (range = "all")}>All</button>
  </div>
</div>

{#if loadError}
  <ErrorState message={`Could not load usage: ${loadError}`} onRetry={load} />
{:else if !snapshot}
  <div class="skeletons">
    <Skeleton width="200px" height="30px" />
    <Skeleton height="220px" radius="12px" />
    <Skeleton height="120px" radius="12px" />
  </div>
{:else}
  <section class="summary">
    <StatCard label="Sessions" value={String(inRange.length)} />
    <StatCard label="Total tokens" value={formatTokens(totalTokens)} />
    <StatCard label="Models" value={String(modelBars.length)} />
    <StatCard label="Accounts tracked" value={String(snapshot.accounts.length)} />
    <StatCard label="Est. cost (all-time)" value={costAvailable ? formatUsd(snapshot.estimatedCostUsd ?? 0) : "n/a"} unit={costAvailable ? "" : "unavailable"} />
  </section>

  <section class="panel">
    <p class="ptitle">Tokens over time</p>
    <Card><div class="pad"><AreaChart columns={areaColumns} series={areaSeries} /></div></Card>
  </section>

  <div class="cols">
    <section class="panel">
      <p class="ptitle">By model{modelFilter ? ` · filtering ${modelFilter}` : ""}</p>
      <Card><div class="pad"><BarChart items={modelBars} selected={modelFilter} onselect={toggleModel} /></div></Card>
      {#if costAvailable}<p class="footnote">{costFootnote}</p>{/if}
    </section>
    <section class="panel">
      <p class="ptitle">By provider</p>
      <Card><div class="pad"><Donut slices={providerSlices} selected={providerHighlight} onselect={toggleProvider} /></div></Card>
    </section>
  </div>

  <section class="panel">
    <div class="tablehead">
      <p class="ptitle">Sessions</p>
      <SearchField bind:value={query} placeholder="Search sessions" />
    </div>
    <Card>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Source</th>
              <th>Models</th>
              <th class="num"><button class="sortbtn" onclick={() => setSort("tokens")}>Tokens{sortArrow("tokens")}</button></th>
              <th class="num"><button class="sortbtn" onclick={() => setSort("messages")}>Msgs{sortArrow("messages")}</button></th>
              <th class="num"><button class="sortbtn" onclick={() => setSort("updated")}>Updated{sortArrow("updated")}</button></th>
            </tr>
          </thead>
          <tbody>
            {#each pageRows as session (session.id)}
              <tr>
                <td class="title" title={session.project ? session.title + " · " + session.project : session.title}>
                  <span class="tname">{session.title}</span>
                  {#if session.project}<span class="tproject">{session.project}</span>{/if}
                </td>
                <td>{sourceLabel(session.source)}</td>
                <td class="models" title={modelList(session)}>{modelList(session)}</td>
                <td class="num">{formatTokens(sessionTokens(session))}</td>
                <td class="num">{session.messageCount}</td>
                <td class="num">{formatUpdated(session.updated)}</td>
              </tr>
            {:else}
              <tr><td colspan="6" class="empty">No sessions in this range</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
    {#if sorted.length > 0}
      <div class="pager">
        <span>Showing {page * PAGE_SIZE + 1} to {Math.min(sorted.length, (page + 1) * PAGE_SIZE)} of {sorted.length}</span>
        <div class="pbtns">
          <button disabled={page === 0} onclick={() => (page = Math.max(0, page - 1))}>Prev</button>
          <button disabled={page >= pageCount - 1} onclick={() => (page = Math.min(pageCount - 1, page + 1))}>Next</button>
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
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
  .ranges {
    display: flex;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
    flex: none;
  }
  .ranges button {
    border: none;
    background: none;
    color: var(--muted);
    font-family: var(--ui);
    font-size: 12px;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
  }
  .ranges button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
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
  .ptitle {
    font-size: 10.5px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
    margin: 0 2px 10px;
  }
  .footnote {
    margin: 8px 2px 0;
    font-size: 11px;
    color: var(--faint);
  }
  .pad {
    padding: 14px 16px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 16px;
  }
  .tablehead {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .tablehead .ptitle {
    margin: 0;
  }
  .tablewrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    text-align: left;
    color: var(--faint);
    font-weight: 600;
    font-size: 11px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th.num {
    text-align: right;
  }
  .sortbtn {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: var(--faint);
    font-weight: 600;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
  }
  .sortbtn:hover {
    color: var(--muted);
  }
  td {
    padding: 9px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td.num {
    text-align: right;
    font-family: var(--mono);
    color: var(--muted);
  }
  .tname {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tproject {
    display: block;
    font-size: 10.5px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.title {
    font-weight: 600;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  td.models {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11.5px;
  }
  td.empty {
    color: var(--faint);
    text-align: center;
    padding: 22px;
  }
  tr:last-child td {
    border-bottom: 0;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 10px 2px 0;
    font-size: 11.5px;
    color: var(--faint);
  }
  .pbtns {
    display: flex;
    gap: 6px;
  }
  .pbtns button {
    font-family: var(--ui);
    font-size: 12px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .pbtns button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
