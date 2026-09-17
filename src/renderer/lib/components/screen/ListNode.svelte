<script lang="ts">
  import type { ScreenNode, ItemShape } from "@forebay/shared";
  import ItemList from "../ItemList.svelte";
  import ItemBox from "../ItemBox.svelte";
  import ActionButton from "./ActionButton.svelte";
  import EmptyState from "../EmptyState.svelte";
  import type { ScreenContext } from "./context.js";

  interface Row { id: string; [key: string]: unknown }

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const rows = $derived(Array.isArray(ctx.sources[node.source as string]) ? (ctx.sources[node.source as string] as Row[]) : []);
  const shape = $derived((node.item ?? {}) as Partial<ItemShape>);
  const rowActions = $derived(Array.isArray(node.rowActions) ? (node.rowActions as string[]) : []);
  // A screen names its own long lists rather than Forebay guessing from row count, since a
  // plugin knows which of its lists can grow unbounded.
  const virtualizeAfter = $derived(node.virtual === true ? 0 : 40);

  function field(row: Row, key: string | undefined): string {
    return key ? String(row[key] ?? "") : "";
  }
</script>

<ItemList items={rows} key={(row) => row.id} {virtualizeAfter}>
  {#snippet item(row: Row)}
    <ItemBox title={field(row, shape.title)} subtitle={field(row, shape.subtitle)}>
      {#snippet actions()}
        {#each rowActions as actionId (actionId)}
          <ActionButton {ctx} {actionId} args={{ id: row.id }} />
        {/each}
      {/snippet}
    </ItemBox>
  {/snippet}
  {#snippet empty()}
    <EmptyState message={typeof node.empty === "string" ? node.empty : "Nothing to show."} />
  {/snippet}
</ItemList>
