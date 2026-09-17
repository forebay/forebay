<script lang="ts">
  import type { AccountQuota } from "@forebay/shared";
  import ItemBox from "./ItemBox.svelte";
  import StatusPill from "./StatusPill.svelte";
  import type { StatusVariant } from "./StatusPill.svelte";
  import ToggleSwitch from "./ToggleSwitch.svelte";
  import Button from "./Button.svelte";

  const QUOTA_CHIP_CAP = 3;
  const WARN_THRESHOLD = 0.8;

  // No column may carry a minimum the panel cannot give it: fixed widths added up to more than
  // the dialog is wide, which pushed the toggle and Remove past its edge.
  const COLUMNS = "minmax(0, 1.6fr) auto minmax(0, 1fr) auto auto";

  let {
    label,
    detail = "",
    status,
    enabled,
    quota = [],
    onToggle,
    onRemove,
  }: {
    label: string;
    detail?: string;
    status: { variant: StatusVariant; label: string };
    enabled: boolean;
    quota?: AccountQuota[];
    onToggle?: (on: boolean) => void;
    onRemove?: () => void;
  } = $props();

  function percentUsed(remainingFraction: number): number {
    const used = Math.max(0, Math.min(1, 1 - remainingFraction));
    return Math.round(used * 100);
  }

  const visibleQuota = $derived(quota.slice(0, QUOTA_CHIP_CAP));
  const hiddenQuotaCount = $derived(Math.max(0, quota.length - QUOTA_CHIP_CAP));
</script>

<ItemBox columns={COLUMNS} title={label} subtitle={detail}>
  {#snippet actions()}
    <div><StatusPill variant={status.variant} label={status.label} /></div>
    <div class="quotas">
      {#each visibleQuota as q, i (q.label ?? `quota-${i}`)}
        {@const pct = percentUsed(q.remainingFraction ?? 1)}
        <span
          class="qchip"
          class:warn={pct / 100 >= WARN_THRESHOLD}
          title={q.label ? `${q.label}: ${pct}% used` : `${pct}% used`}
        >
          {#if q.label}<span class="qlabel">{q.label}</span>{/if}
          <span class="qpct">{pct}%</span>
        </span>
      {:else}
        <span class="none">No quota data</span>
      {/each}
      {#if hiddenQuotaCount > 0}
        <span class="qmore">+{hiddenQuotaCount}</span>
      {/if}
    </div>
    <ToggleSwitch checked={enabled} label={`${label} enabled`} onchange={onToggle} />
    {#if onRemove}
      <Button onclick={onRemove}>Remove</Button>
    {:else}
      <span></span>
    {/if}
  {/snippet}
</ItemBox>

<style>
  .quotas {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
    overflow: hidden;
  }
  .qchip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--good);
    background: var(--surface-2);
    border: var(--hairline) solid var(--border);
    border-radius: var(--radius-pill);
    padding: var(--space-3xs) var(--space-sm);
    white-space: nowrap;
  }
  .qchip.warn {
    color: var(--warn);
  }
  .qlabel {
    color: var(--muted);
  }
  .qpct {
    font-weight: 600;
  }
  .qmore {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--faint);
  }
  .none {
    font-size: var(--fs-xs);
    color: var(--faint);
  }
</style>
