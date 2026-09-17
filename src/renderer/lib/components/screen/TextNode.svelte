<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const text = $derived(
    typeof node.text === "string" ? node.text : typeof node.source === "string" ? String(ctx.sources[node.source] ?? "") : "",
  );
</script>

{#if text}<span>{text}</span>{/if}
