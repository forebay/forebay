<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import ScreenRenderer from "./ScreenRenderer.svelte";
  import { styleOf } from "./registry.js";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();
</script>

<div class="box" class:row={node.kind === "row"} style={styleOf(node.style)}>
  {#each node.children ?? [] as child, i (i)}
    <ScreenRenderer node={child} {ctx} />
  {/each}
</div>

<style>
  .box { display: flex; flex-direction: column; gap: var(--space-lg); }
  .box.row { flex-direction: row; align-items: center; }
</style>
