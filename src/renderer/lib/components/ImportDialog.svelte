<script lang="ts">
  import { onMount } from "svelte";
  import type { ImportPreview, ImportSelection } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { track } from "../downloads.js";
  import Button from "./Button.svelte";
  import { fadeMotion, flyMotion } from "../util/motion.js";

  let { app, label, onClose, onDone }: { app: string; label: string; onClose: () => void; onDone: (notes: string[]) => void } = $props();

  let preview = $state<ImportPreview | null>(null);
  let error = $state("");
  let busy = $state(false);
  let selection = $state<ImportSelection>({ accounts: true, routing: true, exposure: true });

  let panel = $state<HTMLDivElement | undefined>(undefined);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  async function run(): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    const result = await track(`Import ${label}`, app, () => forebay.importRun(app, selection));
    busy = false;
    if (result.ok) {
      onDone(result.data.notes);
      onClose();
    } else {
      error = result.error;
    }
  }

  onMount(() => panel?.focus());

  onMount(async () => {
    const result = await forebay.importPreview(app);
    if (result.ok) preview = result.data;
    else error = result.error;
  });
</script>

<svelte:window onkeydown={onKeydown} />
<div class="backdrop" role="presentation" onclick={onClose} transition:fadeMotion></div>
<div class="dialog" role="dialog" aria-modal="true" tabindex="-1" bind:this={panel} aria-label={`Import ${label} config`} transition:flyMotion={{ y: 8 }}>
  <h3>Import from {label}</h3>
  {#if error}
    <p class="error">{error}</p>
  {:else if !preview}
    <p class="hint">Reading {label} config…</p>
  {:else}
    <p class="hint">Choose what to merge into Forebay.</p>
    <label class="opt">
      <input type="checkbox" bind:checked={selection.accounts} />
      <span>Accounts</span>
      <span class="count">{preview.accounts}</span>
    </label>
    <label class="opt">
      <input type="checkbox" bind:checked={selection.routing} />
      <span>Routing</span>
      <span class="count">{preview.routingSlots === null ? "n/a" : preview.routingSlots}</span>
    </label>
    <label class="opt">
      <input type="checkbox" bind:checked={selection.exposure} />
      <span>Provider exposure</span>
      <span class="count">{preview.exposedProviders}</span>
    </label>
  {/if}
  <div class="actions">
    <Button onclick={onClose}>Cancel</Button>
    <Button variant="primary" disabled={!preview || busy} onclick={run}>Import</Button>
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
    width: min(92vw, 420px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dialog:focus {
    outline: none;
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
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text);
    padding: 6px 0;
  }
  .opt .count {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--faint);
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
    margin-top: 4px;
  }
</style>
