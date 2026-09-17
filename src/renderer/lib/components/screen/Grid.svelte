<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import ScreenRenderer from "./ScreenRenderer.svelte";
  import { styleOf } from "./registry.js";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();
  const columns = $derived(typeof node.columns === "number" && node.columns > 0 ? node.columns : 2);
</script>

<div class="grid" style={`grid-template-columns:repeat(${columns},minmax(0,1fr));${styleOf(node.style)}`}>
  {#each node.children ?? [] as child, i (i)}
    <ScreenRenderer node={child} {ctx} />
  {/each}
</div>

<style>
  .grid { display: grid; gap: var(--space-lg); }
</style>
