<script lang="ts">
  import type { Snippet } from "svelte";

  // One setting: its name and what it does on the left, the control on the right. Every
  // settings surface uses this so a plugin's controls sit on the same rhythm as Forebay's own.
  let {
    name,
    description = "",
    controlId = "",
    note = "",
    tone = "muted",
    control,
  }: {
    name: string;
    description?: string;
    controlId?: string;
    note?: string;
    tone?: "muted" | "good" | "bad";
    control: Snippet;
  } = $props();
</script>

<div class="row">
  <div class="info">
    {#if controlId}
      <label class="name" for={controlId}>{name}</label>
    {:else}
      <span class="name">{name}</span>
    {/if}
    {#if description}<span class="desc">{description}</span>{/if}
  </div>
  <div class="widget">
    {@render control()}
    {#if note}<span class="note" class:good={tone === "good"} class:bad={tone === "bad"}>{note}</span>{/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2xl);
    padding: var(--space-xl) var(--space-2xl);
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    min-width: 0;
  }
  .name {
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: -.01em;
  }
  .desc {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .widget {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2xs);
    flex: none;
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .note.good {
    color: var(--good);
  }
  .note.bad {
    color: var(--crit);
  }
</style>
