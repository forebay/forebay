<script lang="ts">
  import { onMount } from "svelte";
  import type { CatalogKind, RepoRef, Result } from "@forebay/shared";
  import { parseRepoRef, classifyRepoName } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { track } from "../downloads.js";
  import Button from "./Button.svelte";
  import { fadeMotion, flyMotion } from "../util/motion.js";

  let {
    home,
    onClose,
    onInstalled,
    install,
  }: {
    home: string;
    onClose: () => void;
    onInstalled: () => void;
    install?: (repo: RepoRef) => Promise<Result<unknown>>;
  } = $props();

  let url = $state("");
  let busy = $state(false);
  let error = $state("");

  const parsed = $derived(parseRepoRef(url));
  const kind = $derived<CatalogKind | null>(parsed ? classifyRepoName(parsed.repo) ?? "plugin" : null);

  let urlInput = $state<HTMLInputElement | undefined>(undefined);
  onMount(() => urlInput?.focus());

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  function defaultInstall(repo: RepoRef): Promise<Result<unknown>> {
    return track(`Install ${repo.repo}`, home, () => forebay.pluginsInstall(home, repo.repo, repo.url));
  }

  async function handleInstall(): Promise<void> {
    if (!parsed || busy) return;
    busy = true;
    error = "";
    const result = await (install ?? defaultInstall)(parsed);
    busy = false;
    if (result.ok) {
      onInstalled();
      onClose();
    } else {
      error = result.error;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />
<div class="backdrop" role="presentation" onclick={onClose} transition:fadeMotion></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Add a plugin from a URL" transition:flyMotion={{ y: 8 }}>
  <h3>Add from URL</h3>
  <p class="hint">Install any provider, proxy, or plugin from a GitHub repository. A repository that does not follow the plugin contract installs but will not be picked up.</p>
  <input class="url" placeholder="owner/repo or GitHub URL" aria-label="Repository URL" bind:value={url} bind:this={urlInput} />
  {#if parsed}
    <div class="preview">
      <span class="name">{parsed.repo}</span>
      {#if kind}<span class="kind">{kind}</span>{/if}
    </div>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    <Button onclick={onClose}>Cancel</Button>
    <Button variant="primary" disabled={!parsed || busy} onclick={handleInstall}>Install</Button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .35);
    z-index: 40;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 41;
    width: min(92vw, 440px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .url {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
  }
  .url:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .preview .name {
    font-weight: 600;
    font-size: 13px;
  }
  .preview .kind {
    font-size: 10.5px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--faint);
    background: var(--surface-2);
    padding: 2px 7px;
    border-radius: 20px;
  }
  .error {
    margin: 0;
    color: var(--crit);
    font-size: 12.5px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
