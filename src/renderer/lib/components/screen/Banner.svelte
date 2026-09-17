<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const text = $derived(typeof node.source === "string" ? String(ctx.sources[node.source] ?? "") : "");
  const tone = $derived(typeof node.tone === "string" ? node.tone : "info");
</script>

{#if text}
  <div class="banner" class:warn={tone === "warn"} class:bad={tone === "bad"} class:good={tone === "good"} role="status">{text}</div>
{/if}

<style>
  .banner {
    font-size: var(--fs-xs);
    color: var(--accent);
    background: var(--accent-weak);
    border: var(--hairline) solid var(--accent-border);
    border-radius: var(--radius-sm);
    padding: var(--space-md) var(--space-xl);
  }
  .banner.warn {
    color: var(--warn);
    background: var(--warn-weak);
    border-color: var(--warn);
  }
  .banner.bad {
    color: var(--crit);
    background: var(--crit-weak);
    border-color: var(--crit);
  }
  .banner.good {
    color: var(--good);
    background: var(--good-weak);
    border-color: var(--good);
  }
</style>
