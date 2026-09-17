<script lang="ts">
  let { size = 14 }: { size?: number } = $props();
</script>

<svg class="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label="Loading" data-testid="spinner">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
</svg>

<style>
  .spin {
    display: inline-block;
    vertical-align: -2px;
    animation: forebay-spin 0.7s linear infinite;
  }
  @keyframes forebay-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin { animation: none; }
  }
</style>
