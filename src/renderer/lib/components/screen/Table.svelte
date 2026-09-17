<script lang="ts">
  import type { ScreenNode, Column } from "@forebay/shared";
  import EmptyState from "../EmptyState.svelte";
  import ActionButton from "./ActionButton.svelte";
  import type { ScreenContext } from "./context.js";

  interface Row { id: string; [key: string]: unknown }

  let { node, ctx }: { node: ScreenNode; ctx: ScreenContext } = $props();

  const rows = $derived(Array.isArray(ctx.sources[node.source as string]) ? (ctx.sources[node.source as string] as Row[]) : []);
  const columns = $derived(Array.isArray(node.columns) ? (node.columns as Column[]) : []);
  const groupKey = $derived(typeof node.groupBy === "string" ? node.groupBy : "");
  const rowActions = $derived(Array.isArray(node.rowActions) ? (node.rowActions as string[]) : []);

  const groups = $derived.by(() => {
    if (!groupKey) return [{ label: "", rows }];
    const byKey = new Map<string, Row[]>();
    for (const row of rows) {
      const label = String(row[groupKey] ?? "");
      byKey.set(label, [...(byKey.get(label) ?? []), row]);
    }
    return [...byKey.entries()].map(([label, r]) => ({ label, rows: r })).sort((a, b) => a.label.localeCompare(b.label));
  });

  function cell(row: Row, column: Column): string {
    const value = String(row[column.key] ?? "");
    return column.truncate && value.length > column.truncate ? value.slice(0, column.truncate - 1) + "…" : value;
  }
</script>

{#if rows.length === 0}
  <EmptyState message={typeof node.empty === "string" ? node.empty : "Nothing to show."} />
{:else}
  {#each groups as group (group.label)}
    {#if group.label}<div class="gname">{group.label} <span class="count">{group.rows.length}</span></div>{/if}
    <ul>
      {#each group.rows as row (row.id)}
        <li>
          {#each columns as column (column.key)}
            <span class={"c " + (column.tone ?? "normal")} title={String(row[column.key] ?? "")}>{cell(row, column)}</span>
          {/each}
          {#each rowActions as actionId (actionId)}
            <ActionButton {ctx} {actionId} args={{ id: row.id }} />
          {/each}
        </li>
      {/each}
    </ul>
  {/each}
{/if}

<style>
  .gname { font-family: var(--mono); font-weight: 600; font-size: var(--fs-sm); }
  .count { font-size: var(--fs-micro); font-weight: 600; color: var(--muted); background: var(--surface-2); border-radius: var(--radius-pill); padding: 1px var(--space-sm); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
  li { display: flex; align-items: baseline; gap: var(--space-xs); font-size: var(--fs-sm); }
  .c { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .c.muted { color: var(--muted); }
  .c.mono { font-weight: 600; }
  .c.old { color: var(--crit); max-width: 40ch; }
  .c.new { color: var(--accent); max-width: 40ch; }
</style>
