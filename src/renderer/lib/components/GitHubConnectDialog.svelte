<script lang="ts">
  import { forebay } from "../ipc.js";
  import { fadeMotion, flyMotion } from "../util/motion.js";
  import Button from "./Button.svelte";

  let { mode, ghLogin, onCancel, onDone }: {
    mode: "add" | "connect";
    ghLogin?: string;
    onCancel: () => void;
    onDone: () => void;
  } = $props();

  // For "add" mode: choice between signing in (OAuth device flow) or pasting a
  // token. "connect" mode has no sub-view; it always uses the local gh CLI token.
  type AddView = "choice" | "token" | "device";
  let addView = $state<AddView>("choice");

  let token = $state("");
  let star = $state(true);
  let busy = $state(false);
  let error = $state("");
  let confirmBtn = $state<HTMLButtonElement | undefined>(undefined);

  let deviceUserCode = $state("");
  let deviceVerificationUri = $state("");
  let deviceIntervalSeconds = $state(5);
  let devicePollTimer: ReturnType<typeof setTimeout> | undefined;
  let devicePolling = false;

  const title = $derived(
    mode === "add" ? "Add GitHub account" : ghLogin ? `Connect @${ghLogin}` : "Connect GitHub account",
  );
  const showConfirmButton = $derived(mode !== "add" || addView === "token");
  const confirmLabel = $derived(mode === "add" ? "Add account" : "Connect");
  const confirmDisabled = $derived(busy || (mode === "add" && addView === "token" && !token.trim()));

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") cancel();
  }

  $effect(() => {
    if (showConfirmButton) confirmBtn?.focus();
  });

  $effect(() => {
    return stopPolling;
  });

  function stopPolling(): void {
    devicePolling = false;
    if (devicePollTimer !== undefined) {
      clearTimeout(devicePollTimer);
      devicePollTimer = undefined;
    }
  }

  function scheduleNextPoll(seconds: number): void {
    if (!devicePolling) return;
    devicePollTimer = setTimeout(pollDevice, seconds * 1000);
  }

  function cancel(): void {
    stopPolling();
    onCancel();
  }

  async function confirm(): Promise<void> {
    if (confirmDisabled) return;
    busy = true;
    error = "";
    try {
      const result = mode === "add"
        ? await forebay.githubAddAccount(token.trim(), star)
        : await forebay.githubConnectGhCli(star);
      if (result.ok) {
        onDone();
      } else {
        error = result.error;
      }
    } finally {
      busy = false;
    }
  }

  async function startDeviceFlow(): Promise<void> {
    busy = true;
    error = "";
    try {
      const result = await forebay.githubDeviceStart();
      if (!result.ok) {
        error = result.error;
        return;
      }
      deviceUserCode = result.data.userCode;
      deviceVerificationUri = result.data.verificationUri;
      deviceIntervalSeconds = result.data.intervalSeconds;
      addView = "device";
      stopPolling();
      devicePolling = true;
      scheduleNextPoll(deviceIntervalSeconds);
    } finally {
      busy = false;
    }
  }

  async function pollDevice(): Promise<void> {
    if (!devicePolling) return;
    const result = await forebay.githubDevicePoll(star);
    if (!devicePolling) return;
    if (!result.ok) {
      stopPolling();
      error = result.error;
      return;
    }
    if (result.data.status === "pending") {
      scheduleNextPoll(result.data.intervalSeconds ?? deviceIntervalSeconds);
      return;
    }
    stopPolling();
    if (result.data.status === "authorized") {
      onDone();
    } else if (result.data.status === "expired") {
      error = "The code expired before it was confirmed.";
    } else if (result.data.status === "denied") {
      error = "Sign-in was denied.";
    } else {
      error = result.data.message || "Sign-in failed.";
    }
  }

  function retryDeviceFlow(): void {
    error = "";
    addView = "choice";
  }

  function openVerificationUri(): void {
    window.open(deviceVerificationUri, "_blank");
  }
</script>

<svelte:window onkeydown={onKeydown} />
<div class="backdrop" role="presentation" onclick={cancel} transition:fadeMotion></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label={title} transition:flyMotion={{ y: 8 }}>
  <h3>{title}</h3>

  <div class="permissions">
    <span class="permlabel">Forebay will use this token to</span>
    <ul>
      <li>Read repositories and metadata, to list and enrich the plugin marketplace (names, logos, versions), including private repositories your token can access.</li>
      <li>Read organization data, to discover available plugins and loaders.</li>
      <li>Star repositories, used only to star Forebay, if you leave the box below checked.</li>
    </ul>
  </div>

  {#if mode === "add"}
    {#if addView === "choice"}
      <div class="choice">
        <button class="btn primary wide" disabled={busy} onclick={startDeviceFlow}>Sign in with GitHub</button>
        <button class="linkbtn" disabled={busy} onclick={() => (addView = "token")}>Paste a token instead</button>
      </div>
    {:else if addView === "token"}
      <input
        type="password"
        class="token"
        placeholder="Personal access token"
        aria-label="GitHub personal access token"
        bind:value={token}
      />
      <span class="hint">Create a personal access token with read access to repositories (include public_repo or repo to allow starring).</span>
    {:else if addView === "device"}
      <div class="device">
        <span class="devicecodelabel">Your code</span>
        <span class="devicecode">{deviceUserCode}</span>
        <span class="hint">Enter this code at</span>
        <button class="btn" onclick={openVerificationUri}>Open github.com/login/device</button>
        {#if !error}<span class="waiting">Waiting for authorization…</span>{/if}
      </div>
    {/if}
  {:else}
    <span class="hint">Uses the token from your signed-in GitHub CLI.</span>
  {/if}

  <label class="starrow">
    <input type="checkbox" bind:checked={star} />
    <span>Star Forebay on GitHub to support the project</span>
  </label>

  {#if error}
    <div class="error">{error}</div>
    {#if mode === "add" && addView === "device"}
      <button class="linkbtn" onclick={retryDeviceFlow}>Try again</button>
    {/if}
  {/if}

  <div class="actions">
    <Button disabled={busy} onclick={cancel}>Cancel</Button>
    {#if showConfirmButton}
      <button
        bind:this={confirmBtn}
        class="btn primary"
        disabled={confirmDisabled}
        onclick={confirm}
      >
        {confirmLabel}
      </button>
    {/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 40; }
  .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 41; width: min(94vw, 440px); max-height: 88vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0; font-size: 15px; font-weight: 650; }
  .permissions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .permlabel {
    font-size: 11.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .permissions ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .permissions li {
    font-size: 11.5px;
    color: var(--muted);
    line-height: 1.4;
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .linkbtn {
    all: unset;
    cursor: pointer;
    font-size: 11.5px;
    color: var(--muted);
  }
  .linkbtn:hover:not(:disabled) {
    color: var(--text);
    text-decoration: underline;
  }
  .device {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 0 4px;
  }
  .devicecodelabel {
    font-size: 11px;
    color: var(--faint);
  }
  .devicecode {
    font-family: var(--mono, monospace);
    font-size: 26px;
    font-weight: 700;
    letter-spacing: .08em;
    color: var(--text);
    user-select: all;
    padding: 4px 10px;
  }
  .waiting {
    font-size: 11.5px;
    color: var(--muted);
  }
  .token {
    font-family: var(--ui);
    font-size: 12px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 7px 9px;
  }
  .token:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .hint {
    font-size: 11px;
    color: var(--faint);
  }
  .starrow {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
  }
  .error {
    font-size: 11px;
    color: var(--crit);
  }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn {
    font-family: var(--ui);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    border-radius: 8px;
    padding: 8px 13px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
  }
  .btn.wide {
    justify-content: center;
    width: 100%;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn.primary:hover {
    filter: brightness(1.05);
  }
  .btn:disabled {
    opacity: .5;
    cursor: not-allowed;
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
