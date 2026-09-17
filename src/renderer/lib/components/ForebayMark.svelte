<script lang="ts">
  import { renderForebayMark, FOREBAY_ON_ACCENT } from "@forebay/shared";

  let { size = 24, onAccent = false }: { size?: number; onAccent?: boolean } = $props();

  const markup = $derived(onAccent ? renderForebayMark(size, FOREBAY_ON_ACCENT) : renderForebayMark(size));
</script>

<span class="forebay-mark" style="width:{size}px;height:{size}px">{@html markup}</span>

<style>
  .forebay-mark {
    display: inline-flex;
    line-height: 0;
    flex: none;
  }
</style>
