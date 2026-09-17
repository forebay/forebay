<script lang="ts" module>
  // The one place every plugin/app logo is rendered. A logo asset (the icon.svg a
  // manifest names) is a square SVG; this renders it in a fixed square box, scaled to
  // fit whole (never cropped), so a stray non-square or oversized source still
  // lays out cleanly. Renderers pass one of the standard sizes.
  //
  // An icon arrives either as a URL (a data URI built from a plugin's icon.svg) or as SVG
  // markup. Both are accepted here because they are not interchangeable downstream: markup
  // inlined into the page resolves the theme's CSS variables, while the same markup behind an
  // <img> is an isolated document where those variables resolve to nothing and the mark comes
  // out blank. Forebay's own theme-aware mark is markup for exactly that reason.
  export const LOGO_SIZE = { list: 34, detail: 56, compact: 26 } as const;
</script>

<script lang="ts">
  import type { CatalogKind } from "@forebay/shared";
  let { icon = "", name, kind, size = LOGO_SIZE.list }: { icon?: string; name: string; kind?: CatalogKind; size?: number } = $props();

  // Deterministic hue from the name so each lettermark is stable and distinct.
  function hue(text: string): number {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    return h;
  }
  const letter = $derived((name.replace(/[^A-Za-z0-9]/g, "")[0] ?? "?").toUpperCase());
  const tint = $derived(kind === "provider" ? 265 : kind === "proxy" ? 200 : hue(name));
  const markup = $derived(icon.trimStart().startsWith("<svg") ? icon : "");
</script>

{#if markup}
  <span class="icon glyph" role="img" aria-label={name} style="width:{size}px;height:{size}px">{@html markup}</span>
{:else if icon}
  <img class="icon" src={icon} alt="" width={size} height={size} style="width:{size}px;height:{size}px" />
{:else}
  <span
    class="lettermark"
    aria-hidden="true"
    style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.42)}px;background:hsl({tint} 45% 42%)"
  >{letter}</span>
{/if}

<style>
  .glyph {
    display: inline-block;
    overflow: hidden;
  }
  .glyph :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .icon {
    border-radius: 8px;
    object-fit: contain;
    flex-shrink: 0;
    background: var(--surface-2);
  }
  .lettermark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #fff;
    font-weight: 600;
    flex-shrink: 0;
    user-select: none;
  }
</style>
