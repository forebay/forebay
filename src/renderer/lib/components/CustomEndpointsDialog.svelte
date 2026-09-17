<script lang="ts">
  import { onMount } from "svelte";
  import type { CustomEndpointView } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { navigate } from "../router.js";
  import { track } from "../downloads.js";
  import Button from "./Button.svelte";
  import Dialog from "./Dialog.svelte";

  let { onClose }: { onClose: () => void } = $props();

  // Translators are marketplace entries now, so "where do more formats come from" has a real
  // answer to point at rather than a note saying to go and look.
  function browseTranslators(): void {
    onClose();
    navigate("plugins", { kind: "translator" });
  }

  let installed = $state(true);
  let endpoints = $state<CustomEndpointView[]>([]);
  let error = $state("");
  let busy = $state(false);
  let dirtyHint = $state(false);

  // The plugin translates the wire formats, so it is asked which exist rather than the
  // dashboard keeping a list that would drift from what the plugin can actually serve.
  let formats = $state<string[]>([]);
  let form = $state({ id: "", label: "", baseUrl: "", format: "", models: "" });
  let keyDraft = $state<Record<string, string>>({});


  async function refresh(): Promise<void> {
    const engines = await forebay.enginesList();
    const engine = engines.ok ? engines.data.find((e) => e.capability === "custom-endpoints") : undefined;
    installed = !!engine && Object.values(engine.homes).some((h) => h.installed);
    if (!installed) { endpoints = []; return; }
    const [list, supported] = await Promise.all([forebay.customEndpointsList(), forebay.customEndpointsFormats()]);
    if (list.ok) endpoints = list.data;
    else error = list.error;
    if (supported.ok) {
      formats = supported.data;
      if (!form.format && formats.length > 0) form.format = formats[0];
    }
  }

  async function install(): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    const result = await track("Install engine", "forebay", () => forebay.enginesEnsure("custom-endpoints"));
    busy = false;
    if (result.ok) await refresh();
    else error = result.error;
  }

  async function addEndpoint(): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    const endpoint = {
      id: form.id.trim(),
      label: form.label.trim(),
      baseUrl: form.baseUrl.trim(),
      format: form.format,
      models: form.models.split(",").map((m) => m.trim()).filter(Boolean),
    };
    const result = await forebay.customEndpointsUpsert(endpoint);
    busy = false;
    if (result.ok) {
      form = { id: "", label: "", baseUrl: "", format: formats[0] ?? "", models: "" };
      dirtyHint = true;
      await refresh();
    } else {
      error = result.error;
    }
  }

  async function removeEndpoint(id: string): Promise<void> {
    error = "";
    const result = await forebay.customEndpointsRemove(id);
    if (result.ok) { dirtyHint = true; await refresh(); }
    else error = result.error;
  }

  async function saveKey(id: string): Promise<void> {
    error = "";
    const key = keyDraft[id];
    if (!key) return;
    const result = await forebay.customEndpointsSaveKey(id, key);
    if (result.ok) { keyDraft = { ...keyDraft, [id]: "" }; await refresh(); }
    else error = result.error;
  }

  onMount(refresh);
</script>

<Dialog title="Custom endpoints" testid="custom-endpoints" width="md" {onClose}>
  {#snippet body()}
    {#if !installed}
      <p class="hint">The custom endpoints engine is not installed. It serves your configured endpoints.</p>
    {:else}
      <div class="list">
        {#each endpoints as ep (ep.id)}
          <div class="ep">
            <div class="ephead">
              <span class="name">{ep.label}</span>
              <span class="fmt">{ep.format}</span>
              <span class="key" class:set={ep.hasKey}>{ep.hasKey ? "key set" : "no key"}</span>
              <button class="rm" onclick={() => removeEndpoint(ep.id)} aria-label={"Remove " + ep.label}>Remove</button>
            </div>
            <div class="epmeta">{ep.id} · {ep.baseUrl} · {ep.models.join(", ")}</div>
            <div class="keyrow">
              <input type="password" placeholder="Set API key" aria-label={"API key for " + ep.label} bind:value={keyDraft[ep.id]} />
              <Button disabled={!keyDraft[ep.id]} onclick={() => saveKey(ep.id)}>Save key</Button>
            </div>
          </div>
        {:else}
          <p class="hint">No endpoints yet. Add one below.</p>
        {/each}
      </div>

      <div class="form">
        <p class="ptitle">Add endpoint</p>
        <label>Endpoint id<input aria-label="Endpoint id" bind:value={form.id} placeholder="myendpoint" /></label>
        <label>Label<input aria-label="Label" bind:value={form.label} placeholder="My endpoint" /></label>
        <label>Base URL<input aria-label="Base URL" bind:value={form.baseUrl} placeholder="https://host/v1" /></label>
        <label>Format
          <select aria-label="Format" bind:value={form.format}>
            {#each formats as f (f)}<option value={f}>{f}</option>{/each}
          </select>
        </label>
        <p class="formats-note">
          {formats.length === 0
            ? "No wire formats available. A translator is what teaches this provider a vendor's format."
            : "More formats come from installed translators."}
          <button type="button" class="link" onclick={browseTranslators}>Browse translators</button>
        </p>
        <label>Models<input aria-label="Models (comma separated)" bind:value={form.models} placeholder="gpt-4o, gpt-4o-mini" /></label>
        <Button variant="primary" disabled={busy} onclick={addEndpoint}>Add endpoint</Button>
      </div>
      {#if dirtyHint}<p class="hint">Restart the Local API to apply new endpoints and models to routing.</p>{/if}
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/snippet}

  {#snippet actions()}
    {#if !installed}
      <Button variant="primary" disabled={busy} onclick={install}>Install engine</Button>
    {/if}
    <Button onclick={onClose}>Close</Button>
  {/snippet}
</Dialog>

<style>
  .formats-note {
    margin: 0;
    grid-column: 1 / -1;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-family: var(--ui);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .hint { margin: 0; font-size: 12px; color: var(--muted); }
  .ptitle { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); font-weight: 600; margin: 6px 0 2px; }
  .list { display: flex; flex-direction: column; gap: 10px; }
  .ep { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .ephead { display: flex; align-items: center; gap: 10px; }
  .ephead .name { font-weight: 600; font-size: 13px; }
  .fmt { font-size: 10.5px; text-transform: uppercase; color: var(--faint); background: var(--surface-2); padding: 2px 7px; border-radius: 20px; }
  .key { font-size: 11px; color: var(--faint); }
  .key.set { color: var(--good); }
  .rm { margin-left: auto; background: none; border: none; color: var(--crit); font-size: 12px; cursor: pointer; }
  .epmeta { font-size: 11.5px; color: var(--faint); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; }
  .keyrow { display: flex; gap: 8px; }
  .keyrow input { flex: 1; }
  .form { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--muted); }
  input, select { font-family: var(--ui); font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
  input:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
  .error { margin: 0; color: var(--crit); font-size: 12.5px; }
</style>
