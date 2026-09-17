<script lang="ts">
  import type { ActionSpec } from "@forebay/shared";
  import { forebay } from "../../ipc.js";
  import Button from "../Button.svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import type { ScreenContext } from "./context.js";

  let { ctx, actionId, args = {} }: { ctx: ScreenContext; actionId: string; args?: Record<string, unknown> } = $props();

  let declared = $state<ActionSpec[]>([]);

  async function load(homeId: string, plugin: string): Promise<void> {
    const result = await forebay.configSchemas(homeId);
    const full = result.ok ? (result.data.find((s) => s.plugin === plugin) ?? null) : null;
    declared = full?.actions ?? [];
  }

  $effect(() => {
    void load(ctx.homeId, ctx.plugin);
  });

  // An id the plugin never declared (a screen-only action) still has to work, just without
  // the label/confirm/danger metadata that would come from an ActionSpec.
  const action = $derived(declared.find((a) => a.id === actionId) ?? { id: actionId, label: actionId });

  let confirming = $state(false);

  function run(): void {
    if (ctx.busy) return;
    if (action.confirm) { confirming = true; return; }
    void ctx.invoke(action.id, args);
  }

  function confirmed(): void {
    confirming = false;
    void ctx.invoke(action.id, args);
  }
</script>

<Button disabled={ctx.busy} variant={action.danger ? "danger" : "default"} onclick={run}>{action.label}</Button>

{#if confirming}
  <ConfirmDialog
    title={action.label}
    message={action.confirm ?? ""}
    danger={!!action.danger}
    onConfirm={confirmed}
    onCancel={() => (confirming = false)}
  />
{/if}
