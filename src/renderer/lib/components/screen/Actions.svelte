<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import ActionButton from "./ActionButton.svelte";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const ids = $derived(Array.isArray(node.ids) ? (node.ids as string[]) : []);
</script>

<div class="actions">
  {#each ids as id (id)}
    <ActionButton {ctx} actionId={id} />
  {/each}
</div>

<style>
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
</style>
