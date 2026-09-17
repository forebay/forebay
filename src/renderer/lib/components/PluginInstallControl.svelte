<script lang="ts">
  import type { UnifiedPlugin } from "@forebay/shared";
  import type { DownloadRow } from "../downloads.js";
  import SplitButton from "./SplitButton.svelte";

  let {
    plugin,
    homes,
    block = false,
    activity = null,
    updateAvailable = false,
    updatesEnabled = false,
    behindHomes = [],
    brokenHomes = [],
    onUpdate,
    onRepairHome,
    onUpdateHome,
    onInstallAll,
    onRemoveEverywhere,
    onToggleHome,
  }: {
    plugin: UnifiedPlugin;
    homes: { id: string; label: string; icon?: string }[];
    block?: boolean;
    activity?: DownloadRow | null;
    updateAvailable?: boolean;
    // False hides every update affordance: nothing here manages updates, so offering
    // one would promise something no installed plugin can carry out.
    updatesEnabled?: boolean;
    behindHomes?: string[];
    // Homes where the plugin is installed but only partly built.
    brokenHomes?: string[];
    onUpdate?: () => void;
    onRepairHome?: (homeId: string) => void;
    onUpdateHome?: (homeId: string) => void;
    onInstallAll: () => void;
    onRemoveEverywhere: () => void;
    onToggleHome: (homeId: string, on: boolean) => void;
  } = $props();

  const installedCount = $derived(homes.filter((h) => plugin.homes[h.id]?.installed).length);
  const fullyInstalled = $derived(installedCount === homes.length && homes.length > 0);
  const installableRemainingHomes = $derived(homes.filter((h) => !plugin.homes[h.id]?.installed));
  const showUpdate = $derived(updatesEnabled && updateAvailable);
  // A half-built copy is broken right now, which outranks every other offer here.
  const brokenInstalledHomes = $derived(
    onRepairHome ? homes.filter((h) => plugin.homes[h.id]?.installed && brokenHomes.includes(h.id)) : [],
  );
  const isRepair = $derived(brokenInstalledHomes.length > 0);
  // An update then outranks removal and installing into the homes still missing it: a copy
  // that is behind is the next most broken thing. Both stay in the menu, where nothing is lost.
  const isUpdate = $derived(!isRepair && showUpdate && installedCount > 0 && !!onUpdate);
  const isRemoveAll = $derived(fullyInstalled && !isUpdate && !isRepair);
  const behindInstalledHomes = $derived(
    showUpdate && onUpdateHome ? homes.filter((h) => plugin.homes[h.id]?.installed && behindHomes.includes(h.id)) : [],
  );
  // A queued or running download for this plugin freezes the button into a
  // progress state so it can't be re-triggered mid-flight.
  const busy = $derived(activity?.status === "pending" || activity?.status === "installing");
  const primaryDisabled = $derived(busy || (!isRemoveAll && !isUpdate && !isRepair && installableRemainingHomes.length === 0));
  const idleLabel = $derived(
    isRepair
      ? (brokenInstalledHomes.length === 1 ? `Repair in ${brokenInstalledHomes[0].label}` : `Repair ${brokenInstalledHomes.length} installs`)
      : isUpdate
      ? "Update"
      : isRemoveAll
        ? (homes.length === 1 ? `Remove from ${homes[0].label}` : "Remove everywhere")
        : installableRemainingHomes.length === 1
          ? `Install in ${installableRemainingHomes[0].label}`
          : installedCount === 0 && installableRemainingHomes.length === homes.length
            ? "Install everywhere"
            : `Install in ${installableRemainingHomes.length}`,
  );
  const primaryLabel = $derived(
    activity?.status === "pending"
      ? "Pending…"
      : activity?.status === "installing"
        ? (activity.percent >= 0 ? `Installing… ${activity.percent}%` : "Installing…")
        : idleLabel,
  );
</script>

{#snippet menu()}
  {#each brokenInstalledHomes as h (h.id)}
    <button onclick={() => onRepairHome?.(h.id)}>Repair in {h.label}</button>
  {/each}
  {#each behindInstalledHomes as h (h.id)}
    <button onclick={() => onUpdateHome?.(h.id)}>Update in {h.label}</button>
  {/each}
  <!-- One remaining home is already covered by its own entry below. -->
  {#if isUpdate && installableRemainingHomes.length > 1}
    <button onclick={onInstallAll}>Install in {installableRemainingHomes.length} more</button>
  {/if}
  {#each homes as h (h.id)}
    {@const on = !!plugin.homes[h.id]?.installed}
    {#if on}
      <button class="danger" onclick={() => onToggleHome(h.id, false)}>Remove from {h.label}</button>
    {:else}
      <button onclick={() => onToggleHome(h.id, true)}>Install in {h.label}</button>
    {/if}
  {/each}
  {#if installedCount > 0 && (!fullyInstalled || isUpdate || isRepair)}
    <button class="danger" onclick={onRemoveEverywhere}>Remove everywhere</button>
  {/if}
{/snippet}

<SplitButton
  label={primaryLabel}
  danger={isRemoveAll && !busy}
  disabled={primaryDisabled}
  progress={busy && activity ? activity.percent : -1}
  {block}
  onPrimary={() => (isRepair ? brokenInstalledHomes.forEach((h) => onRepairHome?.(h.id)) : isUpdate ? onUpdate?.() : isRemoveAll ? onRemoveEverywhere() : onInstallAll())}
  {menu}
/>

<style>
</style>
