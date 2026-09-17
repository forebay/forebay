<script lang="ts">
  import { formatBytes } from "@forebay/shared";
  import { onMount } from "svelte";
  import type { FieldSpec } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import Card from "./Card.svelte";
  import ToggleSwitch from "./ToggleSwitch.svelte";
  import SettingRow from "./SettingRow.svelte";

  let fields = $state<FieldSpec[]>([]);
  let values = $state<Record<string, unknown>>({});
  let stats = $state<{ bytes: number; segments: number; oldestTs?: number } | null>(null);
  let loadError = $state("");

  const groups = $derived.by(() => {
    const byGroup = new Map<string, FieldSpec[]>();
    for (const field of fields) {
      const name = field.group || "General";
      const list = byGroup.get(name) ?? [];
      list.push(field);
      byGroup.set(name, list);
    }
    return Array.from(byGroup, ([name, items]) => ({ name, items }));
  });

  function labelFor(field: FieldSpec): string {
    return field.label || field.key;
  }

  async function load(): Promise<void> {
    try {
      const result = await forebay.globalSettingsRead();
      if (!result.ok) {
        loadError = result.error;
        return;
      }
      loadError = "";
      fields = result.data.fields;
      values = { ...result.data.defaults, ...result.data.current };
      const storage = await forebay.activityStats();
      if (storage.ok) stats = storage.data;
    } catch (e) {
      loadError = (e as { message?: string }).message ?? String(e);
    }
  }

  async function write(key: string, value: unknown): Promise<void> {
    values = { ...values, [key]: value };
    try {
      await forebay.setConfig("settings", key, value);
    } catch (e) {
      loadError = (e as { message?: string }).message ?? String(e);
    }
  }

  onMount(() => { void load(); });
</script>

<Card>
  <div class="intro">
    <h2>Shared settings</h2>
    <p class="desc">
      Stored in this home's <code>config/settings.json</code> and read by every plugin. A change applies to newly
      started processes; anything already running keeps the value it read.
    </p>
    {#if loadError}
      <p class="error">Could not load settings: {loadError}</p>
    {/if}
  </div>

  {#each groups as group (group.name)}
    <p class="grouphead">{group.name}</p>
    {#each group.items as field (field.key)}
      <SettingRow name={labelFor(field)} description={field.description ?? ""} controlId={field.type === "boolean" ? "" : "gs-" + field.key}>
        {#snippet control()}
          {#if field.type === "boolean"}
            <ToggleSwitch label={labelFor(field)} checked={values[field.key] === true} onchange={(on: boolean) => write(field.key, on)} />
          {:else if field.type === "select"}
            <select
              id={"gs-" + field.key}
              class="control sized"
              value={String(values[field.key] ?? "")}
              onchange={(e) => write(field.key, (e.currentTarget as HTMLSelectElement).value)}
            >
              {#each field.options ?? [] as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {:else if field.type === "number"}
            <input
              id={"gs-" + field.key}
              class="control sized"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={Number(values[field.key] ?? 0)}
              onchange={(e) => write(field.key, Number((e.currentTarget as HTMLInputElement).value))}
            />
          {:else}
            <input
              id={"gs-" + field.key}
              class="control sized"
              type="text"
              value={String(values[field.key] ?? "")}
              onchange={(e) => write(field.key, (e.currentTarget as HTMLInputElement).value)}
            />
          {/if}
        {/snippet}
      </SettingRow>
    {/each}
  {/each}

  {#if stats}
    <p class="stats">
      Activity log: {formatBytes(stats.bytes)} across {stats.segments} segments{stats.oldestTs
        ? `, oldest event ${new Date(stats.oldestTs).toLocaleDateString()}`
        : ""}. Limits apply when the log rotates (about every 1 MB), so a quiet home keeps its history until then.
    </p>
  {/if}
</Card>

<style>
  .intro {
    padding: var(--space-xl) var(--space-2xl) var(--space-xs);
  }
  h2 {
    margin: 0 0 var(--space-2xs);
    font-size: var(--fs-md);
    font-weight: 650;
    letter-spacing: -.01em;
  }
  .grouphead {
    margin: var(--space-lg) var(--space-2xl) 0;
    font-size: var(--fs-micro);
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
  }
  .sized {
    width: var(--track-control);
  }
  .desc,
  .stats {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .stats {
    padding: var(--space-lg) var(--space-2xl) var(--space-xl);
  }
  .error {
    margin: var(--space-sm) 0 0;
    color: var(--crit);
    font-size: var(--fs-sm);
  }
</style>
