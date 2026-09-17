<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import StatCard from "../StatCard.svelte";
  import EmptyState from "../EmptyState.svelte";
  import type { ScreenContext } from "./context.js";

  interface Stat { id: string; label: string; value: string | number; unit?: string; meta?: string }

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const stats = $derived(Array.isArray(ctx.sources[node.source as string]) ? (ctx.sources[node.source as string] as Stat[]) : []);

  function display(value: string | number | undefined): string {
    return value === undefined ? "" : String(value);
  }
</script>

{#if stats.length === 0}
  <EmptyState message={typeof node.empty === "string" ? node.empty : "Nothing to show."} />
{:else}
  <div class="stats">
    {#each stats as stat (stat.id)}
      <StatCard label={stat.label} value={display(stat.value)} unit={stat.unit ?? ""} meta={stat.meta ?? ""} />
    {/each}
  </div>
{/if}

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--track-card), 1fr)); gap: var(--space-md); }
</style>
