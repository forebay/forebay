<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import CollapsibleGroup from "../CollapsibleGroup.svelte";
  import ScreenRenderer from "./ScreenRenderer.svelte";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const label = $derived(typeof node.label === "string" ? node.label : "");
  const open = $derived(node.collapsed !== true);
</script>

<CollapsibleGroup {label} {open}>
  {#snippet body()}
    <div class="body">
      {#each node.children ?? [] as child, i (i)}
        <ScreenRenderer node={child} {ctx} />
      {/each}
    </div>
  {/snippet}
</CollapsibleGroup>

<style>
  .body { display: flex; flex-direction: column; gap: var(--space-md); }
</style>
