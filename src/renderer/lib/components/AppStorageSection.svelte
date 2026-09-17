<script lang="ts">
  import type { AppPathNames, AppStorage } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import Button from "./Button.svelte";
  import Spinner from "./Spinner.svelte";

  let { app }: { app: string } = $props();

  const KINDS: { key: keyof AppPathNames; label: string; hint: string }[] = [
    { key: "repos", label: "Repos", hint: "Cloned plugin sources" },
    { key: "plugin", label: "Plugin", hint: "Deployed plugin bundles" },
    { key: "cache", label: "Cache", hint: "Update checks and metadata" },
    { key: "config", label: "Config", hint: "Plugin configuration files" },
  ];

  let storage = $state<AppStorage | null>(null);
  let draft = $state<AppPathNames | null>(null);
  let saveError = $state("");
  let busy = $state(false);
  let editing = $state(false);

  const changed = $derived.by(() => {
    const current = storage;
    const next = draft;
    if (!current || !next) return false;
    return KINDS.some(({ key }) => next[key].trim() !== current.names[key]);
  });

  async function load(): Promise<void> {
    const result = await forebay.appStorageGet(app);
    if (!result.ok) return;
    storage = result.data;
    draft = { ...result.data.names };
  }

  function startEditing(): void {
    editing = true;
    saveError = "";
    if (storage) draft = { ...storage.names };
  }

  function cancel(): void {
    editing = false;
    saveError = "";
    if (storage) draft = { ...storage.names };
  }

  // The names are only validated in core, so what comes back is the one answer: repeating
  // the rules here is how the two would drift into disagreeing about the same name.
  async function save(): Promise<void> {
    if (!draft || busy) return;
    busy = true;
    saveError = "";
    const result = await forebay.appStorageSet(app, { ...draft });
    busy = false;
    if (!result.ok) {
      saveError = result.error;
      return;
    }
    const moved = result.data.moves.filter((move) => move.status === "moved");
    toast.success(moved.length > 0
      ? `Storage updated, moved ${moved.map((move) => `${move.from} to ${move.to}`).join(", ")}`
      : "Storage updated");
    editing = false;
    await load();
  }

  $effect(() => {
    void app;
    void load();
  });
</script>

<section>
  <div class="head">
    <p class="label">Storage</p>
    {#if !editing && storage}
      <Button onclick={startEditing}>Change</Button>
    {/if}
  </div>

  {#if !storage || !draft}
    <p class="muted">Loading storage…</p>
  {:else}
    <p class="path">{storage.home}</p>
    <div class="grid">
      {#each KINDS as kind (kind.key)}
        <div class="row">
          <span class="name">{kind.label}</span>
          {#if editing}
            <input
              aria-label={kind.label + " directory name"}
              spellcheck="false"
              autocomplete="off"
              bind:value={draft[kind.key]}
            />
          {:else}
            <span class="value">{storage.names[kind.key]}</span>
          {/if}
          <span class="hint">{kind.hint}</span>
        </div>
      {/each}
    </div>

    {#if editing}
      {#if saveError}<p class="error">{saveError}</p>{/if}
      <p class="note">Renaming moves what is already in this home. A name already in use is refused.</p>
      <div class="actions">
        <Button onclick={cancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || !changed} onclick={save}>
          {#if busy}<Spinner />{/if}
          Save
        </Button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .label {
    margin: 0;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .path {
    margin: 6px 0 10px;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .row {
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr) minmax(0, 1.3fr);
    align-items: center;
    gap: 10px;
  }
  .name {
    font-size: 12px;
    color: var(--text);
  }
  .value {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
  }
  .hint {
    font-size: 11px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 8px;
    min-width: 0;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .note {
    margin: 10px 0 0;
    font-size: 11.5px;
    color: var(--faint);
  }
  .error {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--crit);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }
</style>
