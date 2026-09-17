<script lang="ts">
  let { width = "100%", height = "1em", radius = "6px", lines = 1 }:
    { width?: string; height?: string; radius?: string; lines?: number } = $props();
</script>

{#if lines > 1}
  <div class="sk-lines" aria-hidden="true" data-testid="skeleton">
    {#each Array(lines) as _, i}
      <span class="sk" style="height:{height};border-radius:{radius};width:{i === lines - 1 ? '60%' : '100%'}"></span>
    {/each}
  </div>
{:else}
  <span class="sk" aria-hidden="true" data-testid="skeleton" style="width:{width};height:{height};border-radius:{radius}"></span>
{/if}

<style>
  .sk-lines {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sk {
    display: block;
    background: linear-gradient(90deg, var(--surface) 25%, var(--border) 37%, var(--surface) 63%);
    background-size: 400% 100%;
    animation: forebay-shimmer 1.4s ease infinite;
  }
  @keyframes forebay-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: 0 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sk {
      animation: none;
      background: var(--border);
    }
  }
</style>
