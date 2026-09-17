<script lang="ts">
  import type { PluginConfigSchema, PluginSettingsSection } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import Card from "./Card.svelte";
  import PluginControls from "./PluginControls.svelte";
  import Skeleton from "./Skeleton.svelte";

  // A settings section a plugin asked for. Forebay supplies the frame and the attribution;
  // everything inside it is the plugin's own declared controls.
  let { section, homeLabels = {} }: { section: PluginSettingsSection; homeLabels?: Record<string, string> } = $props();

  // A section the plugin declared as spanning homes has one set of controls writing to
  // every home; otherwise each home keeps its own values and the reader picks one.
  const spansHomes = $derived(section.scope === "allHomes");
  const writeHomes = $derived(spansHomes ? section.homes : undefined);

  // The chosen home is only a preference: the section's home list changes as plugins come
  // and go, so the effective home is derived and always one the section still offers.
  let preferredHome = $state("");
  const selectedHome = $derived(section.homes.includes(preferredHome) ? preferredHome : (section.homes[0] ?? ""));
  let schema = $state<PluginConfigSchema | null>(null);
  let loadError = $state("");
  let loaded = $state(false);

  async function load(homeId: string): Promise<void> {
    const result = await forebay.configSchemas(homeId);
    if (selectedHome !== homeId) return;
    loaded = true;
    if (!result.ok) {
      loadError = result.error;
      schema = null;
      return;
    }
    loadError = "";
    schema = result.data.find((s) => s.plugin === section.plugin) ?? null;
  }

  $effect(() => {
    if (selectedHome) void load(selectedHome);
  });

  function labelFor(homeId: string): string {
    return homeLabels[homeId] ?? homeId;
  }
</script>

<section class="category" data-testid={"settings-section-" + section.plugin + "-" + section.id}>
  <div class="head">
    <h2>{section.label}</h2>
    <span class="by">Added by {section.plugin}</span>
  </div>
  {#if !spansHomes && section.homes.length > 1}
    <div class="homes">
      {#each section.homes as homeId (homeId)}
        <button type="button" class="hchip" class:on={selectedHome === homeId} onclick={() => (preferredHome = homeId)}>{labelFor(homeId)}</button>
      {/each}
    </div>
  {/if}
  <Card>
    {#if section.description}<p class="desc">{section.description}</p>{/if}
    {#if !loaded}
      <div class="pending"><Skeleton height="52px" radius="var(--radius-sm)" /></div>
    {:else if loadError}
      <p class="note error">Could not load these settings: {loadError}</p>
    {:else if schema}
      <PluginControls homeId={selectedHome} {schema} sectionId={section.id} {writeHomes} />
    {:else}
      <p class="note">{section.plugin} is not configurable in {labelFor(selectedHome)}.</p>
    {/if}
  </Card>
</section>

<style>
  .category {
    margin-bottom: var(--space-3xl);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    margin: 0 var(--space-3xs) var(--space-md);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 650;
    letter-spacing: -.01em;
  }
  .by {
    font-size: var(--fs-xs);
    color: var(--faint);
  }
  .homes {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
    margin: 0 var(--space-3xs) var(--space-lg);
  }
  .hchip {
    font-size: var(--fs-xs);
    border: var(--hairline) solid var(--border-strong);
    background: var(--surface);
    color: var(--muted);
    border-radius: var(--radius-pill);
    padding: var(--space-3xs) var(--space-lg);
    cursor: pointer;
  }
  .hchip.on {
    background: var(--accent-weak);
    color: var(--accent);
    border-color: var(--accent-border);
  }
  /* The rows inside bring their own padding, so the frame only pads what sits beside them. */
  .desc {
    margin: 0;
    padding: var(--space-xl) var(--space-2xl) var(--space-xs);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .pending,
  .note {
    margin: 0;
    padding: var(--space-xl) var(--space-2xl);
    color: var(--faint);
    font-size: var(--fs-sm);
  }
  .error {
    color: var(--crit);
  }
</style>
