<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import Chip from "../Chip.svelte";
  import EmptyState from "../EmptyState.svelte";
  import type { ScreenContext } from "./context.js";

  interface ChipRow { id: string; label: string; current?: boolean }

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const rows = $derived(Array.isArray(ctx.sources[node.source as string]) ? (ctx.sources[node.source as string] as ChipRow[]) : []);
  const selectAction = $derived(typeof node.select === "string" ? node.select : "");

  function select(row: ChipRow): void {
    if (row.current || ctx.busy || !selectAction) return;
    void ctx.invoke(selectAction, { id: row.id });
  }
</script>

{#if rows.length === 0}
  <EmptyState message={typeof node.empty === "string" ? node.empty : "Nothing to show."} />
{:else}
  <div class="chips">
    {#each rows as row (row.id)}
      <Chip label={row.label} on={!!row.current} onclick={() => select(row)} />
    {/each}
  </div>
{/if}

<style>
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
</style>
