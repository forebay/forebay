<script lang="ts">
  import type { HostApp } from "@forebay/shared";
  import StatusPill from "./StatusPill.svelte";
  import type { StatusVariant } from "./StatusPill.svelte";
  import AppPills from "./AppPills.svelte";
  import ItemBox from "./ItemBox.svelte";
  import PluginIcon, { LOGO_SIZE } from "./PluginIcon.svelte";
  import ToggleSwitch from "./ToggleSwitch.svelte";
  import Chip from "./Chip.svelte";

  let {
    testid = "",
    name,
    id = "",
    logo = "",
    subtitle,
    translator,
    status,
    apps,
    exposure,
    accountLabel,
    enabled,
    onToggle,
    onToggleExposure,
    onOpen,
  }: {
    testid?: string;
    name: string;
    // The provider's mark, already resolved to a data URI; empty falls back to a lettermark.
    logo?: string;
    // Shown beside the display name when the two differ, so the id the rest of the
    // app routes on stays visible without becoming the row's title.
    id?: string;
    subtitle: string;
    translator?: string;
    status: { variant: StatusVariant; label: string; detail?: string };
    apps: HostApp[];
    exposure: Record<string, boolean>;
    accountLabel: string;
    enabled: boolean;
    onToggle?: (on: boolean) => void;
    onToggleExposure?: (appId: string, on: boolean) => void;
    onOpen?: () => void;
  } = $props();

  const COLUMNS = "minmax(150px, 1.4fr) 118px 96px 110px 46px";
</script>

<ItemBox
  columns={COLUMNS}
  {testid}
  title={name}
  {subtitle}
  openTarget="row"
  openLabel={onOpen ? `View ${name}` : ""}
  {onOpen}
>
  {#snippet icon()}
    <PluginIcon icon={logo} name={name} kind="provider" size={LOGO_SIZE.list} />
  {/snippet}
  {#snippet badges()}
    {#if id && id !== name}<span class="pid">{id}</span>{/if}
  {/snippet}
  {#snippet meta()}
    {#if translator}<Chip label={translator} />{/if}
  {/snippet}
  {#snippet actions()}
    <div><StatusPill variant={status.variant} label={status.label} title={status.detail ?? ""} /></div>
    <div onclick={(e) => e.stopPropagation()} role="presentation">
      <AppPills {apps} values={exposure} onToggle={onToggleExposure} />
    </div>
    <div class="acct">{accountLabel}</div>
    <div onclick={(e) => e.stopPropagation()} role="presentation">
      <ToggleSwitch checked={enabled} label={`${name} enabled`} onchange={onToggle} />
    </div>
  {/snippet}
</ItemBox>

<style>
  .acct {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .pid {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--faint);
  }
</style>
