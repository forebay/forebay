<script lang="ts">
  import type { ActivityRecord, Impact } from "@forebay/shared";
  import { humanizeId } from "../util/appLabel.js";
  import Chip from "./Chip.svelte";
  import SearchField from "./SearchField.svelte";

  let {
    records,
    impacts,
    app,
    cause,
    actor,
    source,
    topic,
    query = $bindable(""),
    range,
    onchange,
  }: {
    records: ActivityRecord[];
    impacts: Set<Impact>;
    app: string;
    cause: string;
    actor: string;
    source: string;
    topic: string;
    query?: string;
    range: string;
    onchange: (patch: Record<string, unknown>) => void;
  } = $props();

  const IMPACTS: Impact[] = ["debug", "info", "notice", "warning", "error"];
  const RANGES = ["1h", "24h", "7d", "all"];

  // Every option list comes from the records actually present, never a hardcoded
  // app, plugin, or topic enum.
  function distinct(pick: (record: ActivityRecord) => string | undefined): string[] {
    return Array.from(new Set(records.map(pick).filter((v): v is string => !!v))).sort();
  }

  const apps = $derived.by(() => distinct((r) => r.origin?.app));
  const causes = $derived.by(() => distinct((r) => r.cause?.kind));
  const actors = $derived.by(() => distinct((r) => r.actor));
  const sources = $derived.by(() => distinct((r) => r.source));
  const topics = $derived.by(() => distinct((r) => r.topic));

  function toggleImpact(impact: Impact): void {
    const next = new Set(impacts);
    if (next.has(impact)) next.delete(impact);
    else next.add(impact);
    onchange({ impacts: next });
  }

</script>

<div class="filters">
  <div class="impacts" role="group" aria-label="Impact filter">
    {#each IMPACTS as impact (impact)}
      <Chip label={impact} on={impacts.has(impact)} onclick={() => toggleImpact(impact)} />
    {/each}
  </div>

  <select value={app} aria-label="App" onchange={(e) => onchange({ app: (e.currentTarget as HTMLSelectElement).value })}>
    <option value="">All apps</option>
    {#each apps as id (id)}
      <option value={id}>{humanizeId(id)}</option>
    {/each}
  </select>

  <select value={cause} aria-label="Cause" onchange={(e) => onchange({ cause: (e.currentTarget as HTMLSelectElement).value })}>
    <option value="">Any cause</option>
    {#each causes as kind (kind)}
      <option value={kind}>{kind}</option>
    {/each}
  </select>

  <select value={actor} aria-label="Actor" onchange={(e) => onchange({ actor: (e.currentTarget as HTMLSelectElement).value })}>
    <option value="">Anyone</option>
    {#each actors as who (who)}
      <option value={who}>{who}</option>
    {/each}
  </select>

  <select value={source} aria-label="Source" onchange={(e) => onchange({ source: (e.currentTarget as HTMLSelectElement).value })}>
    <option value="">All sources</option>
    {#each sources as id (id)}
      <option value={id}>{humanizeId(id)}</option>
    {/each}
  </select>

  <select value={topic} aria-label="Topic" onchange={(e) => onchange({ topic: (e.currentTarget as HTMLSelectElement).value })}>
    <option value="">All topics</option>
    {#each topics as id (id)}
      <option value={id}>{id}</option>
    {/each}
  </select>

  <SearchField bind:value={query} placeholder="Search activity" />

  <div class="ranges" role="group" aria-label="Time range">
    {#each RANGES as option (option)}
      <button class:active={range === option} onclick={() => onchange({ range: option })}>{option}</button>
    {/each}
  </div>
</div>

<style>
  .filters {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .impacts {
    display: flex;
    gap: 6px;
  }
  select {
    font-family: var(--ui);
    font-size: 12px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 8px;
  }
  .ranges {
    display: flex;
    gap: 4px;
  }
  .ranges button {
    font-family: var(--ui);
    font-size: 11.5px;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 9px;
    cursor: pointer;
  }
  .ranges button.active {
    color: var(--text);
    background: var(--accent-weak);
    border-color: var(--accent);
  }
</style>
