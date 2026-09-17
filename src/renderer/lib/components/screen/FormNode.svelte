<script lang="ts">
  import type { ScreenNode, FieldSpec, FieldType } from "@forebay/shared";
  import SettingRow from "../SettingRow.svelte";
  import ToggleSwitch from "../ToggleSwitch.svelte";
  import Button from "../Button.svelte";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const fields = $derived(Array.isArray(node.fields) ? (node.fields as FieldSpec[]) : []);
  const submit = $derived(typeof node.submit === "string" ? node.submit : "");

  function defaultFor(type: FieldType): unknown {
    if (type === "boolean") return false;
    if (type === "number") return 0;
    if (type === "list") return [];
    return "";
  }

  let values = $state<Record<string, unknown>>({});

  $effect(() => {
    const next: Record<string, unknown> = {};
    for (const field of fields) next[field.key] = defaultFor(field.type);
    values = next;
  });

  function set(key: string, value: unknown): void {
    values = { ...values, [key]: value };
  }

  function label(field: FieldSpec): string {
    return field.label ?? field.key;
  }

  async function onSubmit(): Promise<void> {
    if (!submit) return;
    await ctx.invoke(submit, values);
  }
</script>

<div class="form">
  {#each fields as field (field.key)}
    <SettingRow name={label(field)} description={field.description ?? ""}>
      {#snippet control()}
        {#if field.type === "boolean"}
          <ToggleSwitch checked={values[field.key] as boolean} label={label(field)} disabled={ctx.busy} onchange={(on) => set(field.key, on)} />
        {:else if field.type === "number"}
          <input class="control" type="number" aria-label={label(field)} disabled={ctx.busy} min={field.min} max={field.max} step={field.step}
            value={values[field.key] as number} oninput={(e) => set(field.key, Number(e.currentTarget.value))} />
        {:else if field.type === "secret"}
          <input class="control" type="password" aria-label={label(field)} disabled={ctx.busy} placeholder={field.placeholder ?? ""}
            value={values[field.key] as string} oninput={(e) => set(field.key, e.currentTarget.value)} />
        {:else if field.type === "select"}
          <select class="control" aria-label={label(field)} disabled={ctx.busy} value={values[field.key] as string}
            onchange={(e) => set(field.key, e.currentTarget.value)}>
            {#each field.options ?? [] as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
          </select>
        {:else if field.type === "multiline"}
          <textarea class="control" aria-label={label(field)} disabled={ctx.busy} rows="3" placeholder={field.placeholder}
            value={values[field.key] as string} oninput={(e) => set(field.key, e.currentTarget.value)}></textarea>
        {:else}
          <input class="control" type="text" aria-label={label(field)} disabled={ctx.busy} placeholder={field.placeholder}
            value={values[field.key] as string} oninput={(e) => set(field.key, e.currentTarget.value)} />
        {/if}
      {/snippet}
    </SettingRow>
  {/each}
  {#if submit}
    <div class="submit"><Button variant="primary" disabled={ctx.busy} onclick={onSubmit}>{submit}</Button></div>
  {/if}
</div>

<style>
  .form { display: flex; flex-direction: column; }
  .control { width: var(--track-control); }
  .submit { display: flex; justify-content: flex-end; padding: var(--space-xl) var(--space-2xl); }
</style>
