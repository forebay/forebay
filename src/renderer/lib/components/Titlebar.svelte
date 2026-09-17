<script lang="ts">
  import { theme, setTheme } from "../theme.js";
  import { forebay } from "../ipc.js";
  import { nav, back, forward } from "../router.js";
  import ForebayMark from "./ForebayMark.svelte";
  import DownloadManager from "./DownloadManager.svelte";
  import GitHubMenu from "./GitHubMenu.svelte";

  let { title = "Forebay", subtitle = "" }: { title?: string; subtitle?: string } = $props();

  const isMac = typeof window !== "undefined" && window.forebay?.platform === "darwin";

  function toggleTheme(): void {
    setTheme($theme === "dark" ? "light" : "dark");
  }
</script>

<div class="titlebar" class:mac={isMac}>
  {#if isMac}<div class="mac-space"></div>{/if}
  <div class="navbtns">
    <button class="navbtn" title="Back" aria-label="Go back" disabled={!$nav.canBack} onclick={back}>‹</button>
    <button class="navbtn" title="Forward" aria-label="Go forward" disabled={!$nav.canForward} onclick={forward}>›</button>
  </div>
  <ForebayMark size={18} />
  <div class="wm">
    <span class="bname">{title}</span>
    {#if subtitle}<span class="bsep">·</span><span class="bsub">{subtitle}</span>{/if}
  </div>
  <div class="spacer"></div>
  <GitHubMenu />
  <DownloadManager />
  <button class="iconbtn" title="Toggle theme" aria-label="Toggle light or dark theme" onclick={toggleTheme}>◐</button>
  {#if !isMac}
    <div class="winctl">
      <button class="wc" aria-label="Minimize window" onclick={() => forebay.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="wc" aria-label="Maximize window" onclick={() => forebay.maximize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="wc close" aria-label="Close window" onclick={() => forebay.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1" /><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1" /></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .titlebar {
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 6px 0 14px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: drag;
    user-select: none;
  }
  .mac-space {
    width: 54px;
    flex: none;
  }
  .navbtns {
    display: flex;
    gap: 2px;
    -webkit-app-region: no-drag;
  }
  .navbtn {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    font-size: 17px;
    line-height: 1;
  }
  .navbtn:hover:not(:disabled) {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
  }
  .navbtn:disabled {
    opacity: .35;
    cursor: default;
  }
  .navbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .wm {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
  }
  .bname {
    font-weight: 650;
    letter-spacing: -.01em;
  }
  .bsep,
  .bsub {
    color: var(--faint);
    font-weight: 500;
  }
  .bsub {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spacer {
    flex: 1;
  }
  .iconbtn {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    font-size: 14px;
    -webkit-app-region: no-drag;
  }
  .iconbtn:hover {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
  }
  .iconbtn:focus-visible,
  .wc:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .winctl {
    display: flex;
    margin-left: 4px;
    -webkit-app-region: no-drag;
  }
  .wc {
    width: 44px;
    height: 40px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .wc:hover {
    background: var(--surface);
    color: var(--text);
  }
  .wc.close:hover {
    background: #c0392b;
    color: #fff;
  }
</style>
