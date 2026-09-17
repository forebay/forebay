<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import Card from "../Card.svelte";
  import ScreenRenderer from "./ScreenRenderer.svelte";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();
</script>

<Card>
  <div class="body">
    {#if typeof node.title === "string" && node.title}<b>{node.title}</b>{/if}
    {#each node.children ?? [] as child, i (i)}
      <ScreenRenderer node={child} {ctx} />
    {/each}
  </div>
</Card>

<style>
  .body { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-xl) var(--space-2xl); }
  b { font-size: var(--fs-sm); font-weight: 650; }
</style>
