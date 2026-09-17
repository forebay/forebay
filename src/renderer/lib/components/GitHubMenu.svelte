<script lang="ts">
  import { onMount } from "svelte";
  import type { GithubStatus } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { githubChanged } from "../githubStore.js";
  import GitHubAccounts from "./GitHubAccounts.svelte";

  let status = $state<GithubStatus | null>(null);
  let open = $state(false);

  let root = $state<HTMLElement | null>(null);
  // A one-way button (e.g. Star Forebay) can remove itself from the DOM the instant
  // it's clicked, so by the time this handler runs e.target is already detached
  // and root.contains(target) would be false. Only close for a click that landed
  // on something still in the document but outside root.
  function onWindowClick(e: MouseEvent): void {
    const target = e.target as Node;
    if (open && root && document.contains(target) && !root.contains(target)) open = false;
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") open = false;
  }

  async function refresh(): Promise<void> {
    const result = await forebay.githubStatus();
    if (result.ok) status = result.data;
  }

  function toggle(): void {
    open = !open;
  }

  onMount(refresh);

  // Keeps the status dot in sync with account changes made from any GitHubAccounts
  // instance (this popover or the Settings screen).
  $effect(() => {
    $githubChanged;
    refresh();
  });
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<div class="ghmenu" bind:this={root}>
  <button
    class="iconbtn"
    title={status?.connected ? (status.name ?? `@${status.login ?? ""}`) : "Not connected to GitHub"}
    aria-label="GitHub connection"
    onclick={toggle}
  >
    <svg class="mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
    <span class="dot" class:on={status?.connected}></span>
  </button>

  {#if open}
    <div class="panel">
      <GitHubAccounts />
    </div>
  {/if}
</div>

<style>
  .ghmenu {
    position: relative;
    -webkit-app-region: no-drag;
  }
  .iconbtn {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
    -webkit-app-region: no-drag;
  }
  .iconbtn:hover {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
  }
  .iconbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .mark {
    width: 14px;
    height: 14px;
  }
  .dot {
    position: absolute;
    bottom: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--faint);
    border: 1.5px solid var(--surface-2);
  }
  .dot.on {
    background: var(--good);
  }
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 280px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    z-index: 50;
    -webkit-app-region: no-drag;
  }
</style>
