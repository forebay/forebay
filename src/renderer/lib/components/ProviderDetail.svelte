<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ProviderRow as ProviderRowData, AccountView, HostApp, PluginConfigSchema } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { toast } from "../toast.js";
  import { accountLabel, accountStatusInfo } from "../util/accountStatus.js";
  import { fadeMotion, flyMotion } from "../util/motion.js";
  import StatusPill from "./StatusPill.svelte";
  import Chip from "./Chip.svelte";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";
  import AccountRow from "./AccountRow.svelte";
  import AppPills from "./AppPills.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import AddAccountDialog from "./AddAccountDialog.svelte";
  import PluginControls from "./PluginControls.svelte";
  import PluginIcon, { LOGO_SIZE } from "./PluginIcon.svelte";

  // Providers are deployed under Forebay's own repos/plugin dirs (see
  // sidecar/modules/providers.ts), so their settings always live in the "forebay"
  // plugin home regardless of which app(s) they're exposed to.
  const PROVIDER_SETTINGS_HOME = "forebay";

  let { provider, apps, onClose, onChanged }: {
    provider: ProviderRowData;
    apps: HostApp[];
    onClose: () => void;
    onChanged: () => void;
  } = $props();

  let accounts = $state<AccountView[]>([]);
  let accountsError = $state("");
  let loaded = $state(false);
  // Local copy of exposure, snapshotted once: the modal owns its own optimistic
  // state after that, updated in handleToggleExposure below.
  let exposure = $state<Record<string, boolean>>(untrack(() => ({ ...provider.exposure })));
  let addOpen = $state(false);
  let pendingConfirm = $state<{ title: string; message: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  let panel = $state<HTMLDivElement | undefined>(undefined);
  let settingsSchema = $state<PluginConfigSchema | null>(null);
  let settingsLoading = $state(true);

  const connected = $derived(accounts.length > 0);
  const status = $derived(connected ? { variant: "good" as const, label: "Connected" } : { variant: "off" as const, label: "Not connected" });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  async function loadAccounts(): Promise<void> {
    const result = await forebay.accountsList(provider.id);
    if (result.ok) {
      accounts = result.data;
      accountsError = "";
    } else {
      accountsError = result.error;
    }
  }

  async function handleToggleAccount(id: string, on: boolean): Promise<void> {
    const result = await forebay.accountsEnable(provider.id, id, on);
    if (!result.ok) toast.error(result.error);
    await loadAccounts();
    onChanged();
  }

  async function handleRemoveAccount(id: string): Promise<void> {
    const result = await forebay.accountsRemove(provider.id, id);
    if (result.ok) toast.success("Account removed");
    else toast.error(result.error);
    await loadAccounts();
    onChanged();
  }

  function confirmRemove(account: AccountView): void {
    pendingConfirm = {
      title: "Remove account?",
      message: `Remove ${accountLabel(account)}? You'll need to sign in again to use it.`,
      confirmLabel: "Remove",
      run: () => handleRemoveAccount(account.id),
    };
  }

  async function handleToggleExposure(appId: string, on: boolean): Promise<void> {
    exposure = { ...exposure, [appId]: on };
    const result = await forebay.providersSetExposure(provider.id, appId, on);
    if (!result.ok) toast.error(result.error);
    onChanged();
  }

  async function loadSettings(): Promise<void> {
    const result = await forebay.configSchemas(PROVIDER_SETTINGS_HOME);
    settingsSchema = result.ok ? (result.data.find((s) => s.plugin === provider.pluginName) ?? null) : null;
    settingsLoading = false;
  }

  onMount(() => {
    loadAccounts().finally(() => (loaded = true));
    loadSettings();
    panel?.focus();
  });
</script>

<svelte:window onkeydown={onKeydown} />
<div class="backdrop" role="presentation" onclick={onClose} transition:fadeMotion></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-label={`${provider.label} details`}
  tabindex="-1"
  bind:this={panel}
  transition:flyMotion={{ y: 8 }}
>
  <div class="header">
    <PluginIcon icon={provider.icon ?? ""} name={provider.label} kind="provider" size={LOGO_SIZE.detail} />
    <div class="titles">
      <h2>{provider.label}</h2>
      <div class="chips">
        <Chip label={provider.authKind === "oauth" ? "OAuth" : "API key"} />
        {#if provider.translator}<Chip label={provider.translator} />{/if}
      </div>
    </div>
    <StatusPill variant={status.variant} label={status.label} />
    <button class="close" aria-label="Close" onclick={onClose}>&times;</button>
  </div>

  <section class="section">
    <div class="section-head">
      <h3>Accounts</h3>
      <Button onclick={() => (addOpen = true)}>Add account</Button>
    </div>
    {#if provider.sharedWith.length > 0}
      <p class="hint">Shares its account pool with {provider.sharedWith.join(", ")}.</p>
    {/if}
    {#if accountsError}
      <p class="error">Could not load accounts: {accountsError}</p>
    {:else if !loaded}
      <p class="hint">Loading accounts...</p>
    {:else if accounts.length === 0}
      <p class="hint">No accounts yet.</p>
    {:else}
      <Card>
        {#each accounts as account (account.id)}
          <AccountRow
            label={accountLabel(account)}
            detail={account.detail ?? ""}
            status={accountStatusInfo(account)}
            enabled={account.enabled}
            quota={account.quota ?? []}
            onToggle={(on) => handleToggleAccount(account.id, on)}
            onRemove={() => confirmRemove(account)}
          />
        {/each}
      </Card>
    {/if}
  </section>

  <section class="section">
    <h3>Availability</h3>
    <AppPills {apps} values={exposure} onToggle={handleToggleExposure} size={26} />
  </section>

  <section class="section">
    <h3>Settings</h3>
    {#if settingsLoading}
      <p class="hint">Loading settings...</p>
    {:else if settingsSchema}
      <PluginControls homeId={PROVIDER_SETTINGS_HOME} schema={settingsSchema} />
    {:else}
      <p class="hint">No settings for this provider.</p>
    {/if}
  </section>
</div>

{#if pendingConfirm}
  <ConfirmDialog
    title={pendingConfirm.title}
    message={pendingConfirm.message}
    confirmLabel={pendingConfirm.confirmLabel}
    danger
    onConfirm={async () => { const p = pendingConfirm; pendingConfirm = null; if (!p) return; await p.run(); }}
    onCancel={() => (pendingConfirm = null)}
  />
{/if}

{#if addOpen}
  <AddAccountDialog
    provider={{ id: provider.id, label: provider.label }}
    onClose={() => (addOpen = false)}
    onAdded={() => { addOpen = false; loadAccounts(); onChanged(); }}
  />
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .35);
    z-index: 40;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 41;
    width: min(94vw, 560px);
    max-height: 88vh;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .dialog:focus {
    outline: none;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .titles h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
    letter-spacing: -.01em;
  }
  .chips {
    display: flex;
    gap: 6px;
  }
  .close {
    all: unset;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    color: var(--muted);
    padding: 4px;
  }
  .close:hover {
    color: var(--text);
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .section h3 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .hint {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .error {
    margin: 0;
    color: var(--crit);
    font-size: 12.5px;
  }
</style>
