<script lang="ts">
  import { onMount } from "svelte";
  import type { GithubStatus } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { githubChanged, bumpGithub } from "../githubStore.js";
  import Button from "./Button.svelte";
  import GitHubConnectDialog from "./GitHubConnectDialog.svelte";

  let status = $state<GithubStatus | null>(null);
  let busy = $state(false);
  let dialog = $state<null | { mode: "add" | "connect"; ghLogin?: string }>(null);
  let starDismissed = $state(false);

  async function refresh(): Promise<void> {
    const result = await forebay.githubStatus();
    if (result.ok) status = result.data;
  }

  onMount(refresh);

  // Every mutation below calls bumpGithub() itself, so the first fire of this
  // effect (right after onMount's own refresh) would be a redundant reload.
  let sawInitialChange = false;
  $effect(() => {
    $githubChanged;
    if (!sawInitialChange) {
      sawInitialChange = true;
      return;
    }
    refresh();
  });

  const ghCliPrompt = $derived.by(() => {
    const s = status;
    if (!s || !s.ghCli) return null;
    const ghCli = s.ghCli;
    return s.accounts.some((a) => a.login === ghCli.login) ? null : ghCli;
  });

  // Non-active accounts only: the active one already has its own identity card above.
  const otherAccounts = $derived.by(() => {
    const s = status;
    return s ? s.accounts.filter((a) => a.login !== s.activeLogin) : [];
  });

  function sourceLine(s: GithubStatus): string {
    if (s.source === "env") return "Connected via environment variable";
    return "";
  }

  function initialOf(label: string): string {
    return label.charAt(0).toUpperCase();
  }

  async function logoutActive(): Promise<void> {
    if (!status?.activeLogin || busy) return;
    busy = true;
    try {
      await forebay.githubRemoveAccount(status.activeLogin);
      await refresh();
      bumpGithub();
    } finally {
      busy = false;
    }
  }

  async function switchAccount(login: string): Promise<void> {
    if (busy || login === status?.activeLogin) return;
    busy = true;
    try {
      await forebay.githubSwitchAccount(login);
      await refresh();
      bumpGithub();
    } finally {
      busy = false;
    }
  }

  async function removeAccount(login: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await forebay.githubRemoveAccount(login);
      await refresh();
      bumpGithub();
    } finally {
      busy = false;
    }
  }

  function openAddDialog(): void {
    dialog = { mode: "add" };
  }

  function openConnectDialog(login: string): void {
    dialog = { mode: "connect", ghLogin: login };
  }

  function cancelDialog(): void {
    dialog = null;
  }

  async function finishDialog(): Promise<void> {
    dialog = null;
    await refresh();
    bumpGithub();
  }

  // One-way: starring is never undone from here, so the button is dismissed the
  // instant it's clicked rather than waiting on the round-trip to settle.
  async function starForebay(): Promise<void> {
    if (busy || !status?.connected) return;
    starDismissed = true;
    busy = true;
    try {
      await forebay.githubStarForebay();
      await refresh();
    } finally {
      busy = false;
    }
  }

  function openOnGitHub(): void {
    // The main process routes http(s) window.open through the external browser.
    if (status?.forebayRepoUrl) window.open(status.forebayRepoUrl, "_blank");
  }
</script>

{#if status}
  <div class="ghaccounts">
    {#if status.connected}
      <div class="identity">
        <span class="avatar" aria-hidden="true">
          {#if status.avatarUrl}
            <img src={status.avatarUrl} alt="" />
          {:else}
            <span class="lettermark">{initialOf(status.name ?? status.login ?? "?")}</span>
          {/if}
        </span>
        <div class="idinfo">
          <span class="name">{status.name ?? (status.login ? `@${status.login}` : "Connected")}</span>
          {#if status.login}<span class="login">@{status.login}</span>{/if}
          {#if sourceLine(status)}<span class="hint">{sourceLine(status)}</span>{/if}
        </div>
        {#if status.source === "config"}
          <Button variant="danger" disabled={busy} onclick={logoutActive}>Log out</Button>
        {/if}
      </div>
    {:else}
      <div class="identity off">
        <div class="idinfo">
          <span class="name">Not connected</span>
          <span class="hint">Add an account to enable the marketplace catalog.</span>
        </div>
      </div>
    {/if}

    {#if ghCliPrompt}
      <div class="ghcli">
        <span>Signed in to GitHub CLI as @{ghCliPrompt.login}. Connect it to Forebay?</span>
        <Button disabled={busy} onclick={() => openConnectDialog(ghCliPrompt.login)}>Connect</Button>
      </div>
    {/if}

    {#if otherAccounts.length > 0}
      <div class="accounts">
        {#each otherAccounts as account (account.login)}
          <div class="account">
            <button
              class="accountbtn"
              disabled={busy}
              onclick={() => switchAccount(account.login)}
            >
              <span class="aavatar" aria-hidden="true">
                {#if account.avatarUrl}
                  <img src={account.avatarUrl} alt="" />
                {:else}
                  <span class="lettermark small">{initialOf(account.name ?? account.login)}</span>
                {/if}
              </span>
              <span class="ainfo">
                <span class="aname">{account.name ?? `@${account.login}`}</span>
                <span class="alogin">@{account.login}</span>
              </span>
            </button>
            <button
              class="remove"
              title={`Log out @${account.login}`}
              aria-label={`Log out @${account.login}`}
              disabled={busy}
              onclick={() => removeAccount(account.login)}
            >
              ×
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="add">
      <Button onclick={openAddDialog}>Add account</Button>
    </div>

    <div class="forebayrow">
      <button class="ghlink" onclick={openOnGitHub}>Open Forebay on GitHub</button>
      {#if status.connected && status.forebayStarred === false && !starDismissed}
        <button
          class="starforebay"
          disabled={busy}
          title="Star Forebay"
          onclick={starForebay}
        >
          ☆ Star Forebay
        </button>
      {/if}
    </div>
  </div>
{/if}

{#if dialog}
  <GitHubConnectDialog
    mode={dialog.mode}
    ghLogin={dialog.ghLogin}
    onCancel={cancelDialog}
    onDone={finishDialog}
  />
{/if}

<style>
  .ghaccounts {
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 10px;
  }
  .identity.off {
    padding-bottom: 6px;
  }
  .avatar,
  .lettermark {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .lettermark {
    display: grid;
    place-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 14px;
    font-weight: 700;
  }
  .idinfo {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .login {
    font-size: 11.5px;
    color: var(--muted);
  }
  .hint {
    font-size: 11px;
    color: var(--faint);
  }
  .ghcli {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    margin-bottom: 10px;
    border-radius: 8px;
    background: var(--accent-weak);
    font-size: 11.5px;
    color: var(--text);
  }
  .accounts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .account {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .accountbtn {
    all: unset;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border-radius: 7px;
    cursor: pointer;
    min-width: 0;
  }
  .accountbtn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .accountbtn:disabled {
    cursor: default;
  }
  .aavatar {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
  }
  .aavatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .lettermark.small {
    width: 100%;
    height: 100%;
    font-size: 10px;
  }
  .ainfo {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
    text-align: left;
  }
  .aname {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .alogin {
    font-size: 10.5px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove {
    all: unset;
    flex: none;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    cursor: pointer;
    color: var(--faint);
    font-size: 14px;
    line-height: 1;
  }
  .remove:hover:not(:disabled) {
    background: var(--crit-weak);
    color: var(--crit);
  }
  .add {
    padding-top: 10px;
    border-top: 1px solid var(--border);
    margin-top: 2px;
  }
  .forebayrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 10px;
    margin-top: 10px;
    border-top: 1px solid var(--border);
  }
  .ghlink {
    all: unset;
    cursor: pointer;
    font-size: 11.5px;
    color: var(--muted);
  }
  .ghlink:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .starforebay {
    all: unset;
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 5px 9px;
  }
  .starforebay:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .starforebay:disabled {
    opacity: .5;
    cursor: default;
  }
</style>
