<script lang="ts">
  import type { PluginConfigSchema, FieldSpec, FieldType, ActionSpec } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import ToggleSwitch from "./ToggleSwitch.svelte";
  import Button from "./Button.svelte";
  import Spinner from "./Spinner.svelte";
  import SettingRow from "./SettingRow.svelte";

  // By default this renders the plugin's whole declaration. `sectionId` narrows it to one
  // contributed section; `hideContributed` drops what such a section already renders, which
  // a screen showing both needs so a control never appears twice.
  //
  // Values are read from, and actions run in, `homeId`. `writeHomes` exists for a setting
  // a plugin declared as spanning homes: the write lands in each of them, so the homes do
  // not drift apart behind one control.
  //
  // `busy` is the caller's own in-flight flag (e.g. a screen invoking another action), separate
  // from `actionBusy` below which tracks a run started by this component's own action buttons.
  let { homeId, schema, sectionId, hideContributed = false, writeHomes, busy = false }:
    { homeId: string; schema: PluginConfigSchema; sectionId?: string; hideContributed?: boolean; writeHomes?: string[]; busy?: boolean } = $props();

  const section = $derived(sectionId ? (schema.layout?.sections ?? []).find((s) => s.id === sectionId) ?? null : null);

  // Declared fields win; otherwise infer typed fields from the flat defaults/current
  // so plugins that never declared capabilities render exactly as before.
  function inferredFields(): FieldSpec[] {
    const keys = [...new Set([...Object.keys(schema.defaults), ...Object.keys(schema.current)])].sort();
    return keys.map((key) => {
      const value = key in schema.current ? schema.current[key] : schema.defaults[key];
      const type: FieldType =
        typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : typeof value === "string" ? "string" : "multiline";
      return { key, type };
    });
  }

  // A plugin that declared nothing is inferred from its values, exactly as before.
  const declared = $derived(schema.fields?.length ? schema.fields : inferredFields());
  const fields = $derived(section ? section.fields : hideContributed ? (schema.layout?.fields ?? declared) : declared);
  const actions = $derived<ActionSpec[]>(
    section ? section.actions : hideContributed ? (schema.layout?.actions ?? schema.actions ?? []) : (schema.actions ?? []),
  );

  const groups = $derived.by(() => {
    const order: string[] = [];
    const byGroup = new Map<string, FieldSpec[]>();
    for (const field of fields) {
      const g = field.group ?? "";
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(field);
    }
    return order.map((g) => ({ name: g, fields: byGroup.get(g)! }));
  });

  // Resolve a dot-path key against nested current/defaults (e.g. "categories.accounts").
  function dig(obj: Record<string, unknown>, dotKey: string): unknown {
    let node: unknown = obj;
    for (const part of dotKey.split(".")) {
      if (node && typeof node === "object" && part in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[part];
      else return undefined;
    }
    return node;
  }

  function initialValue(field: FieldSpec): unknown {
    const fromCurrent = dig(schema.current, field.key);
    const raw = fromCurrent !== undefined ? fromCurrent : dig(schema.defaults, field.key);
    if (field.type === "multiline") return raw === undefined ? "" : typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    if (field.type === "list") return Array.isArray(raw) ? raw : [];
    if (field.type === "secret") return "";
    if (field.type === "select") return raw === undefined ? "" : String(raw);
    return raw;
  }

  // A <select>'s option values are strings; coerce the obvious primitives back so
  // an option value of "true"/"false"/"null"/"42" is stored with its real type.
  function coercePrimitive(value: string): unknown {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
    return value;
  }

  let values = $state<Record<string, unknown>>({});
  let saved = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  let actionBusy = $state<Record<string, boolean>>({});
  let actionOut = $state<Record<string, string>>({});
  let actionErr = $state<Record<string, string>>({});
  let confirming = $state<string | null>(null);
  // The action whose declared args are being collected, and the values typed so far. Transient: an
  // arg is what one run is given, never a setting, so nothing here is saved.
  let collecting = $state<string | null>(null);
  let argValues = $state<Record<string, unknown>>({});

  $effect(() => {
    const next: Record<string, unknown> = {};
    for (const field of fields) next[field.key] = initialValue(field);
    values = next;
  });

  function coerceForSave(field: FieldSpec, value: unknown): unknown {
    if (field.type === "number") return Number(value);
    if (field.type === "select") return coercePrimitive(String(value));
    if (field.type === "multiline") {
      const text = String(value ?? "");
      const trimmed = text.trim();
      if (/^[[{]/.test(trimmed)) { try { return JSON.parse(trimmed); } catch { return text; } }
      return text;
    }
    return value;
  }

  async function save(field: FieldSpec, value: unknown): Promise<void> {
    values = { ...values, [field.key]: value };
    const toWrite = coerceForSave(field, value);
    const homes = writeHomes?.length ? writeHomes : [homeId];
    // A write spanning homes can fail in one and succeed in the rest, so a failure names the
    // home it happened in; with a single home that prefix would only be noise.
    const failures = (await Promise.all(homes.map(async (home) => {
      const result = await forebay.configWrite(home, schema.plugin, field.key, toWrite);
      if (result.ok) return "";
      return homes.length > 1 ? `${home}: ${result.error}` : result.error;
    }))).filter(Boolean);

    saved = { ...saved, [field.key]: failures.length === 0 };
    errors = { ...errors, [field.key]: failures.join("; ") };
  }

  function addListItem(field: FieldSpec): void {
    const list = [...((values[field.key] as unknown[]) ?? [])];
    list.push(field.itemType === "number" ? 0 : "");
    save(field, list);
  }
  function setListItem(field: FieldSpec, index: number, raw: string): void {
    const list = [...((values[field.key] as unknown[]) ?? [])];
    list[index] = field.itemType === "number" ? Number(raw) : raw;
    save(field, list);
  }
  function removeListItem(field: FieldSpec, index: number): void {
    const list = [...((values[field.key] as unknown[]) ?? [])];
    list.splice(index, 1);
    save(field, list);
  }

  async function runAction(action: ActionSpec): Promise<void> {
    confirming = null;
    if (actionBusy[action.id]) return;
    const collected = collecting === action.id ? argValues : undefined;
    collecting = null;
    actionBusy = { ...actionBusy, [action.id]: true };
    actionErr = { ...actionErr, [action.id]: "" };
    actionOut = { ...actionOut, [action.id]: "" };
    try {
      const result = await forebay.configAction(homeId, schema.plugin, action.id, collected);
      if (result.ok) actionOut = { ...actionOut, [action.id]: result.data.stdout || "Done." };
      else actionErr = { ...actionErr, [action.id]: result.error };
    } finally {
      actionBusy = { ...actionBusy, [action.id]: false };
    }
  }

  function onAction(action: ActionSpec): void {
    if (action.confirm) confirming = action.id;
    else beginAction(action);
  }

  // An action declaring args is asked for them before it runs: running it without what it declared
  // is how "create a profile" reached its plugin with no name to create. Confirmation comes first
  // where an action wants both, so a destructive one is agreed to before anything is typed.
  function beginAction(action: ActionSpec): void {
    confirming = null;
    if (!action.args?.length) { runAction(action); return; }
    argValues = {};
    collecting = action.id;
  }

  function setArg(arg: FieldSpec, value: unknown): void {
    argValues = { ...argValues, [arg.key]: value };
  }

  // Visible labels stay clean; aria-labels are plugin-prefixed so a screen with
  // several plugins never has two identically-named controls.
  function aria(field: FieldSpec): string {
    return `${schema.plugin} ${field.label ?? field.key}`;
  }
</script>

{#if fields.length === 0 && actions.length === 0}
  <p class="empty">No controls.</p>
{/if}

{#each groups as group (group.name)}
  <div class="group">
    {#if group.name}<p class="grouphead">{group.name}</p>{/if}
    {#each group.fields as field (field.key)}
      <div data-testid={"control-" + field.key}>
        <SettingRow
          name={field.label ?? field.key}
          description={field.description ?? ""}
          note={errors[field.key] ? errors[field.key] : saved[field.key] ? "Saved" : ""}
          tone={errors[field.key] ? "bad" : "good"}
        >
          {#snippet control()}
            {#if field.type === "boolean"}
              <ToggleSwitch checked={values[field.key] as boolean} label={aria(field)} disabled={busy} onchange={(on) => save(field, on)} />
            {:else if field.type === "number"}
              <input class="control sized" type="number" aria-label={aria(field)} disabled={busy} min={field.min} max={field.max} step={field.step}
                value={values[field.key] as number} onchange={(e) => save(field, Number(e.currentTarget.value))} />
            {:else if field.type === "secret"}
              <input class="control sized" type="password" aria-label={aria(field)} disabled={busy} placeholder={field.placeholder ?? "Set new value"}
                onchange={(e) => save(field, e.currentTarget.value)} />
            {:else if field.type === "select"}
              <select class="control sized" aria-label={aria(field)} disabled={busy} value={values[field.key] as string} onchange={(e) => save(field, e.currentTarget.value)}>
                {#each field.options ?? [] as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            {:else if field.type === "list"}
              <div class="list">
                {#each (values[field.key] as unknown[]) ?? [] as item, i}
                  <div class="listrow">
                    <input class="control sized" type={field.itemType === "number" ? "number" : "text"} aria-label={`${aria(field)} ${i + 1}`} disabled={busy}
                      value={item as string | number} onchange={(e) => setListItem(field, i, e.currentTarget.value)} />
                    <button class="rm" title="Remove" aria-label="Remove" disabled={busy} onclick={() => removeListItem(field, i)}>×</button>
                  </div>
                {/each}
                <button class="add" disabled={busy} onclick={() => addListItem(field)}>+ Add</button>
              </div>
            {:else}
              <textarea class="control sized" aria-label={aria(field)} disabled={busy} rows="3" placeholder={field.placeholder}
                value={values[field.key] as string} onchange={(e) => save(field, e.currentTarget.value)}></textarea>
            {/if}
          {/snippet}
        </SettingRow>
      </div>
    {/each}
  </div>
{/each}

{#each actions as action (action.id)}
  <div class="action">
    <SettingRow
      name={action.label}
      description={action.description ?? ""}
      note={actionErr[action.id] ?? ""}
      tone="bad"
    >
      {#snippet control()}
        {#if collecting === action.id}
          <div class="args">
            {#each action.args ?? [] as arg (arg.key)}
              <label class="arg">
                <span class="argname">{arg.label ?? arg.key}</span>
                {#if arg.type === "boolean"}
                  <input class="control" type="checkbox" disabled={busy} onchange={(e) => setArg(arg, e.currentTarget.checked)} />
                {:else if arg.type === "number"}
                  <input class="control sized" type="number" disabled={busy} onchange={(e) => setArg(arg, Number(e.currentTarget.value))} />
                {:else if arg.type === "secret"}
                  <input class="control sized" type="password" disabled={busy} onchange={(e) => setArg(arg, e.currentTarget.value)} />
                {:else if arg.type === "select"}
                  <select class="control sized" disabled={busy} onchange={(e) => setArg(arg, e.currentTarget.value)}>
                    {#each arg.options ?? [] as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
                  </select>
                {:else}
                  <input class="control sized" type="text" disabled={busy} placeholder={arg.placeholder} onchange={(e) => setArg(arg, e.currentTarget.value)} />
                {/if}
              </label>
            {/each}
            <div class="argbuttons">
              <Button disabled={busy} onclick={() => (collecting = null)}>Cancel</Button>
              <Button variant={action.danger ? "danger" : "primary"} disabled={busy} onclick={() => runAction(action)}>{action.label}</Button>
            </div>
          </div>
        {:else if confirming === action.id}
          <div class="confirm">
            <span>{action.confirm}</span>
            <Button disabled={busy} onclick={() => (confirming = null)}>Cancel</Button>
            <Button variant={action.danger ? "danger" : "primary"} disabled={busy} onclick={() => beginAction(action)}>Confirm</Button>
          </div>
        {:else}
          <Button variant={action.danger ? "danger" : "default"} disabled={actionBusy[action.id] || busy} onclick={() => onAction(action)}>
            {#if actionBusy[action.id]}<Spinner />{/if}
            {action.label}
          </Button>
        {/if}
      {/snippet}
    </SettingRow>
    {#if !actionErr[action.id] && actionOut[action.id]}<pre class="actionout">{actionOut[action.id]}</pre>{/if}
  </div>
{/each}

<style>
  .group {
    display: flex;
    flex-direction: column;
  }
  .grouphead {
    margin: var(--space-lg) var(--space-2xl) 0;
    font-size: var(--fs-micro);
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
  }
  /* One width for every control so a column of rows lines up, whatever each row holds. */
  .sized {
    width: var(--track-control);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .listrow {
    display: flex;
    gap: var(--space-xs);
    align-items: center;
  }
  .rm {
    border: var(--hairline) solid var(--border-strong);
    background: var(--surface);
    color: var(--faint);
    border-radius: var(--radius-xs);
    cursor: pointer;
    width: var(--space-4xl);
    height: var(--space-4xl);
    flex: none;
  }
  .add {
    align-self: flex-end;
    border: var(--hairline) dashed var(--border-strong);
    background: none;
    color: var(--muted);
    border-radius: var(--radius-sm);
    padding: var(--space-2xs) var(--space-md);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .args {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
    align-items: flex-end;
  }
  .arg {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
  }
  .argname {
    color: var(--text-muted);
    font-size: 0.85em;
  }
  .argbuttons {
    display: flex;
    gap: var(--space-2, 0.5rem);
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .actionout {
    margin: 0 var(--space-2xl) var(--space-lg);
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--faint);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: var(--space-xs) var(--space-md);
    overflow: auto;
  }
  .empty {
    margin: 0;
    color: var(--faint);
    font-size: var(--fs-sm);
  }
</style>
