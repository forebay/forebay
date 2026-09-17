<script lang="ts">
  import type { PluginConfigSchema } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import ToggleSwitch from "./ToggleSwitch.svelte";
  import SettingRow from "./SettingRow.svelte";

  // The schema is handed in by whoever already resolved this home's plugin settings, so
  // showing these controls costs no extra probing of the home's bundles.
  let { homeId, schema }: { homeId: string; schema: PluginConfigSchema | null } = $props();

  type Triggers = { loader: boolean; app: boolean; forebay: boolean };

  const MODES = ["off", "check", "update"];
  const TRIGGER_LABELS: { key: keyof Triggers; label: string }[] = [
    { key: "loader", label: "when the launcher menu opens" },
    { key: "app", label: "when this app starts" },
    { key: "forebay", label: "when the dashboard starts" },
  ];

  let modeOverride = $state<string | null>(null);
  let triggersOverride = $state<Triggers | null>(null);
  let loadError = $state("");

  const values = $derived({ ...(schema?.defaults ?? {}), ...(schema?.current ?? {}) } as Record<string, unknown>);

  const storedMode = $derived.by(() => {
    if (typeof values.auto_update_mode === "string" && MODES.includes(values.auto_update_mode)) return values.auto_update_mode;
    if (values.update_on_launch === false) return "check";
    return "update";
  });
  const storedTriggers = $derived.by((): Triggers => {
    const stored = values.auto_update_triggers;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { loader: true, app: true, forebay: true };
    const t = stored as Record<string, unknown>;
    return { loader: t.loader !== false, app: t.app !== false, forebay: t.forebay !== false };
  });

  // A local override shows the change instantly; the stored value governs until then.
  const mode = $derived(modeOverride ?? storedMode);
  const triggers = $derived(triggersOverride ?? storedTriggers);

  // The schema names the plugin these settings belong to, so the write goes back to whichever
  // plugin declared them rather than to one this component knows about.
  async function write(key: string, value: unknown): Promise<void> {
    if (!schema) return;
    try {
      const result = await forebay.configWrite(homeId, schema.plugin, key, value);
      if (!result.ok) loadError = result.error;
    } catch (e) {
      loadError = (e as { message?: string }).message ?? String(e);
    }
  }

  async function setMode(next: string): Promise<void> {
    modeOverride = next;
    await write("auto_update_mode", next);
  }

  // The triggers are one config key, so a single toggle writes the whole object.
  async function setTrigger(key: keyof Triggers, on: boolean): Promise<void> {
    const next = { ...triggers, [key]: on };
    triggersOverride = next;
    await write("auto_update_triggers", next);
  }
</script>

<div class="auto">
  <SettingRow
    name="Automatic updates"
    description="A check always runs on an enabled trigger below, so update badges stay accurate. Only installing is gated: off and check never install, update does."
    controlId={"mode-" + homeId}
  >
    {#snippet control()}
      <select id={"mode-" + homeId} class="control" value={mode} onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value)}>
        {#each MODES as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    {/snippet}
  </SettingRow>

  {#each TRIGGER_LABELS as trigger (trigger.key)}
    <SettingRow name={"Check " + trigger.label}>
      {#snippet control()}
        <ToggleSwitch
          label={"Check " + trigger.label}
          checked={triggers[trigger.key]}
          onchange={(on: boolean) => setTrigger(trigger.key, on)}
        />
      {/snippet}
    </SettingRow>
  {/each}

  {#if loadError}
    <p class="error">Could not read or write this app's update settings: {loadError}</p>
  {/if}
</div>

<style>
  .auto {
    display: flex;
    flex-direction: column;
  }
  .error {
    margin: 0;
    padding: 0 var(--space-2xl) var(--space-lg);
    color: var(--crit);
    font-size: var(--fs-xs);
  }
</style>
