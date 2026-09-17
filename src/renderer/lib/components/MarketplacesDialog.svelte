<script lang="ts">
  import type { MarketplaceSource, MarketplaceSourceType } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import Button from "./Button.svelte";
  import Dialog from "./Dialog.svelte";

  let { onClose, onSaved }: { onClose: () => void; onSaved?: () => void } = $props();

  const TYPES: { id: MarketplaceSourceType; label: string; field: string; hint: string }[] = [
    { id: "github-org", label: "GitHub org", field: "org", hint: "forebay" },
    { id: "manifest", label: "Manifest URL", field: "url", hint: "https://example.com/marketplace.json" },
    { id: "local", label: "Local folder", field: "path", hint: "an absolute path holding marketplace.json" },
  ];

  let sources = $state<MarketplaceSource[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state("");
  let draft = $state({ id: "", label: "", type: "manifest" as MarketplaceSourceType, location: "" });

  const draftType = $derived(TYPES.find((t) => t.id === draft.type) ?? TYPES[0]);

  async function load(): Promise<void> {
    const result = await forebay.marketplaceSourcesList();
    if (result.ok) sources = result.data;
    else error = result.error;
    loaded = true;
  }

  function move(index: number, by: number): void {
    const to = index + by;
    if (to < 0 || to >= sources.length) return;
    const next = [...sources];
    [next[index], next[to]] = [next[to], next[index]];
    sources = next;
  }

  function remove(index: number): void {
    sources = sources.filter((_, i) => i !== index);
  }

  function toggle(index: number): void {
    sources = sources.map((source, i) => (i === index ? { ...source, enabled: source.enabled === false } : source));
  }

  function add(): void {
    const id = draft.id.trim();
    const location = draft.location.trim();
    if (!id || !location) {
      error = "a marketplace needs an id and a location";
      return;
    }
    if (sources.some((source) => source.id === id)) {
      error = `there is already a marketplace with the id ${id}`;
      return;
    }
    error = "";
    sources = [...sources, { id, label: draft.label.trim() || id, type: draft.type, [draftType.field]: location } as MarketplaceSource];
    draft = { id: "", label: "", type: draft.type, location: "" };
  }

  async function save(): Promise<void> {
    busy = true;
    const result = await forebay.marketplaceSourcesSave(sources);
    busy = false;
    if (!result.ok) {
      error = result.error;
      return;
    }
    toast.success("Marketplaces saved");
    onSaved?.();
    onClose();
  }

  function locationOf(source: MarketplaceSource): string {
    return source.org ?? source.url ?? source.path ?? "";
  }

  function typeLabel(type: MarketplaceSourceType): string {
    return TYPES.find((candidate) => candidate.id === type)?.label ?? type;
  }


  $effect(() => {
    if (!loaded) void load();
  });
</script>

<Dialog
  title="Marketplaces"
  subtitle="Browsed together by default. When two publish the same name, the one higher in this list wins."
  width="lg"
  testid="marketplaces-dialog"
  {onClose}
>
  {#snippet body()}

  {#if error}<p class="error">{error}</p>{/if}

  <ul class="list">
    {#each sources as source, index (source.id)}
      <li class:off={source.enabled === false} data-testid={"source-" + source.id}>
        <span class="rank">{index + 1}</span>
        <span class="text">
          <b>{source.label}</b>
          <span class="loc">{typeLabel(source.type)} · {locationOf(source)}</span>
        </span>
        <button type="button" title="Move up" disabled={index === 0} onclick={() => move(index, -1)}>↑</button>
        <button type="button" title="Move down" disabled={index === sources.length - 1} onclick={() => move(index, 1)}>↓</button>
        <button type="button" onclick={() => toggle(index)}>{source.enabled === false ? "Enable" : "Disable"}</button>
        <button type="button" class="danger" onclick={() => remove(index)}>Remove</button>
      </li>
    {:else}
      <li class="empty">No marketplaces configured.</li>
    {/each}
  </ul>

  <div class="add">
    <input aria-label="Marketplace id" placeholder="id" bind:value={draft.id} />
    <input aria-label="Marketplace name" placeholder="name (optional)" bind:value={draft.label} />
    <select aria-label="Marketplace type" bind:value={draft.type}>
      {#each TYPES as type (type.id)}<option value={type.id}>{type.label}</option>{/each}
    </select>
    <input aria-label="Marketplace location" placeholder={draftType.hint} bind:value={draft.location} />
    <Button onclick={add}>Add</Button>
  </div>
  {/snippet}

  {#snippet actions()}
    <Button onclick={onClose}>Cancel</Button>
    <Button variant="primary" disabled={busy} onclick={save}>{busy ? "Saving..." : "Save"}</Button>
  {/snippet}
</Dialog>

<style>
  .error {
    margin: 0;
    color: var(--crit);
    font-size: var(--fs-sm);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm);
    border: var(--hairline) solid var(--border);
    border-radius: var(--radius-xs);
  }
  .list li.off {
    opacity: .55;
  }
  .list li.empty {
    justify-content: center;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .rank {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--faint);
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .text b {
    font-size: var(--fs-sm);
  }
  .loc {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list button,
  .add select,
  .add input {
    font-family: var(--ui);
    font-size: var(--fs-xs);
    color: var(--text);
    background: var(--surface-2);
    border: var(--hairline) solid var(--border);
    border-radius: var(--radius-xs);
    padding: var(--space-2xs) var(--space-xs);
    cursor: pointer;
  }
  .list button:disabled {
    opacity: .4;
    cursor: default;
  }
  .list button.danger {
    color: var(--crit);
  }
  .add {
    display: grid;
    grid-template-columns: 6rem 8rem 9rem minmax(0, 1fr) auto;
    gap: var(--space-xs);
    align-items: center;
  }
  .add input {
    cursor: text;
  }
</style>
