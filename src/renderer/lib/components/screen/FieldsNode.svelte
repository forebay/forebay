<script lang="ts">
  import type { ScreenNode, PluginConfigSchema, FieldSpec } from "@forebay/shared";
  import { forebay } from "../../ipc.js";
  import PluginControls from "../PluginControls.svelte";
  import Skeleton from "../Skeleton.svelte";
  import type { ScreenContext } from "./context.js";

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const keys = $derived(Array.isArray(node.keys) ? (node.keys as string[]) : []);

  let schema = $state<PluginConfigSchema | null>(null);
  let loaded = $state(false);

  // Narrowed through `layout.fields`, not the top-level `fields`: PluginControls treats an
  // empty top-level `fields` as "nothing declared" and infers every default/current key, so a
  // match that comes out empty would render the plugin's whole config surface instead of
  // nothing. `layout.fields` has no such fallback, and `hideContributed` is what reads it.
  async function load(homeId: string, plugin: string, fieldKeys: string[]): Promise<void> {
    loaded = false;
    const result = await forebay.configSchemas(homeId);
    loaded = true;
    const full = result.ok ? (result.data.find((s) => s.plugin === plugin) ?? null) : null;
    if (!full) { schema = null; return; }
    const matched: FieldSpec[] = (full.fields ?? []).filter((field) => fieldKeys.includes(field.key));
    schema = { ...full, layout: { sections: full.layout?.sections ?? [], fields: matched, actions: [] } };
  }

  $effect(() => {
    void load(ctx.homeId, ctx.plugin, keys);
  });
</script>

{#if !loaded}
  <Skeleton height="52px" radius="var(--radius-sm)" />
{:else if schema}
  <PluginControls homeId={ctx.homeId} {schema} hideContributed busy={ctx.busy} />
{/if}
