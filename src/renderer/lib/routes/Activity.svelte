<script lang="ts">
  import { onMount } from "svelte";
  import type { ActivityRecord, Impact } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { setActivityActive } from "../stores/activity.js";
  import Card from "../components/Card.svelte";
  import ActivityFilters from "../components/ActivityFilters.svelte";
  import ActivityRow from "../components/ActivityRow.svelte";
  import ActivityDetailDialog from "../components/ActivityDetailDialog.svelte";
  import { groupByTrace } from "../util/activityTrace.js";
  import Skeleton from "../components/Skeleton.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import EmptyState from "../components/EmptyState.svelte";

  type Range = "1h" | "24h" | "7d" | "all";
  const HOUR_MS = 3_600_000;
  const RANGE_MS: Record<Range, number> = { "1h": HOUR_MS, "24h": HOUR_MS * 24, "7d": HOUR_MS * 24 * 7, all: 0 };
  const PAGE_LIMIT = 200;
  // Every "load older" page raises the cap, so a fetched page is never dropped by the
  // merge that keeps a long-running session bounded.
  const BASE_CAPACITY = 500;

  let records = $state<ActivityRecord[]>([]);
  let loadError = $state("");
  let loaded = $state(false);
  let activeImpacts = $state<Set<Impact>>(new Set());
  let sourceFilter = $state("");
  let topicFilter = $state("");
  let appFilter = $state("");
  let causeFilter = $state("");
  let actorFilter = $state("");
  let query = $state("");
  let range = $state<Range>("24h");
  let openRecord = $state<ActivityRecord | null>(null);
  let expandedGroupId = $state<string | null>(null);
  let nextCursor = $state<string | undefined>(undefined);
  let loadingOlder = $state(false);
  let capacity = $state(BASE_CAPACITY);

  const cutoff = $derived(range === "all" ? 0 : Date.now() - RANGE_MS[range]);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (r.ts < cutoff) return false;
      if (activeImpacts.size > 0 && !activeImpacts.has(r.impact)) return false;
      if (sourceFilter && r.source !== sourceFilter) return false;
      if (topicFilter && r.topic !== topicFilter) return false;
      if (appFilter && r.origin?.app !== appFilter) return false;
      if (causeFilter && r.cause?.kind !== causeFilter) return false;
      if (actorFilter && r.actor !== actorFilter) return false;
      if (q && !r.text.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  function applyFilters(patch: Record<string, unknown>): void {
    if (patch.impacts instanceof Set) activeImpacts = patch.impacts as Set<Impact>;
    if (typeof patch.app === "string") appFilter = patch.app;
    if (typeof patch.cause === "string") causeFilter = patch.cause;
    if (typeof patch.actor === "string") actorFilter = patch.actor;
    if (typeof patch.source === "string") sourceFilter = patch.source;
    if (typeof patch.topic === "string") topicFilter = patch.topic;
    if (typeof patch.range === "string") range = patch.range as Range;
  }

  const groups = $derived.by(() => groupByTrace(filtered));

  function toggleGroup(id: string): void {
    expandedGroupId = expandedGroupId === id ? null : id;
  }

  // Merges by id (priority wins on a duplicate) and sorts newest-first, so a
  // live push that lands during the initial load's async gap survives instead
  // of being wiped out by the fetched page, and a live push received twice
  // doesn't duplicate. Caps the result so a long-running session doesn't grow
  // the in-memory list unbounded.
  function mergeRecords(existing: ActivityRecord[], priority: ActivityRecord[]): ActivityRecord[] {
    const byId = new Map<string, ActivityRecord>();
    for (const record of priority) byId.set(record.id, record);
    for (const record of existing) if (!byId.has(record.id)) byId.set(record.id, record);
    return Array.from(byId.values())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, capacity);
  }

  async function load(): Promise<void> {
    const result = await forebay.activityRead({ limit: PAGE_LIMIT });
    if (result.ok) {
      records = mergeRecords(records, result.data.records);
      nextCursor = result.data.nextCursor;
      loadError = "";
    } else {
      loadError = result.error;
    }
    loaded = true;
  }

  // Paging re-walks from the newest segment, so an older page carries an upper bound as
  // well as the cursor: without it a deep page costs the whole history.
  async function loadOlder(): Promise<void> {
    if (!nextCursor || loadingOlder) return;
    loadingOlder = true;
    capacity += PAGE_LIMIT;
    const oldest = records.length ? records[records.length - 1].ts : undefined;
    const result = await forebay.activityRead({ limit: PAGE_LIMIT, cursor: nextCursor, until: oldest });
    if (result.ok) {
      records = mergeRecords(records, result.data.records);
      nextCursor = result.data.nextCursor;
    } else {
      loadError = result.error;
    }
    loadingOlder = false;
  }

  onMount(() => {
    setActivityActive(true);
    void load();
    const stopLive = forebay.onActivityEvent((record) => {
      records = mergeRecords(records, [record]);
    });
    return () => {
      stopLive();
      setActivityActive(false);
    };
  });
</script>

<div class="head">
  <div>
    <h1>Activity</h1>
    <p>Live event stream across every connected home.</p>
  </div>
</div>

<ActivityFilters
  records={records}
  impacts={activeImpacts}
  app={appFilter}
  cause={causeFilter}
  actor={actorFilter}
  source={sourceFilter}
  topic={topicFilter}
  bind:query
  range={range}
  onchange={applyFilters}
/>

{#if loadError}
  <ErrorState message={`Could not load activity: ${loadError}`} onRetry={load} />
{:else if !loaded}
  <div class="skeletons">
    <Skeleton height="52px" radius="12px" />
    <Skeleton height="52px" radius="12px" />
    <Skeleton height="52px" radius="12px" />
  </div>
{:else if filtered.length === 0}
  <EmptyState message="No activity matches your filters." />
{:else}
  <Card>
    <ul class="list">
      {#each groups as group (group.root.id)}
        <li>
          <ActivityRow
            record={group.root}
            followerCount={group.followers.length}
            cascadeExpanded={expandedGroupId === group.root.id}
            onopen={() => (openRecord = group.root)}
            oncascade={() => toggleGroup(group.root.id)}
          />
          {#if expandedGroupId === group.root.id}
            {#each group.followers as hop (hop.record.id)}
              <ActivityRow
                record={hop.record}
                follower={true}
                depth={hop.depth}
                onopen={() => (openRecord = hop.record)}
              />
            {/each}
          {/if}
        </li>
      {/each}
    </ul>
  </Card>
  {#if nextCursor}
    <div class="more">
      <button onclick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "Loading..." : "Load older"}</button>
    </div>
  {/if}
{/if}

{#if openRecord}
  <ActivityDetailDialog record={openRecord} onClose={() => (openRecord = null)} />
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
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
  .more {
    display: flex;
    justify-content: center;
    padding: 12px 0 4px;
  }
  .more button {
    font-family: var(--ui);
    font-size: 12px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 14px;
    cursor: pointer;
  }
  .more button:disabled {
    color: var(--muted);
    cursor: default;
  }
</style>
