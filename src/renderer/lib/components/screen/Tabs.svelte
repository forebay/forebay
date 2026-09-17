<script lang="ts">
  import type { ScreenNode } from "@forebay/shared";
  import ScreenRenderer from "./ScreenRenderer.svelte";
  import type { ScreenContext } from "./context.js";

  interface Tab { id: string; label: string; child: ScreenNode }

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();
  const tabs = $derived(Array.isArray(node.tabs) ? (node.tabs as Tab[]) : []);
  let selected = $state("");
  const active = $derived(tabs.find((tab) => tab.id === selected) ?? tabs[0]);
</script>

<div class="tabs">
  {#each tabs as tab (tab.id)}
    <button class:on={active?.id === tab.id} onclick={() => (selected = tab.id)}>{tab.label}</button>
  {/each}
</div>
{#if active}
  <ScreenRenderer node={active.child} {ctx} />
{/if}

<style>
  .tabs { display: flex; gap: var(--space-xs); margin: 0 var(--space-3xs) var(--space-lg); }
  button { font-size: var(--fs-xs); border: var(--hairline) solid var(--border-strong); background: var(--surface); color: var(--muted); border-radius: var(--radius-pill); padding: var(--space-3xs) var(--space-lg); cursor: pointer; }
  button.on { background: var(--accent-weak); color: var(--accent); border-color: var(--accent-border); }
</style>
