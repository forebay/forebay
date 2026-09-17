<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import { NODE_RENDERERS } from "./registry.js";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const Renderer = $derived(NODE_RENDERERS[node.kind] ?? null);
</script>

{#if Renderer}
  <Renderer {node} {ctx} />
{/if}
