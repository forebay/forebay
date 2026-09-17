<script lang="ts">
  import { onMount } from "svelte";
  import { PLUGIN_MANAGEMENT } from "@forebay/shared";
  import type { HomePlugins, PluginConfigSchema, PluginSettingsSection } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { applyThemeSetting } from "../theme.js";
  import type { ThemeSetting } from "../theme.js";
  import Card from "../components/Card.svelte";
  import ToggleSwitch from "../components/ToggleSwitch.svelte";
  import PluginControls from "../components/PluginControls.svelte";
  import ContributedSection from "../components/ContributedSection.svelte";
  import SettingRow from "../components/SettingRow.svelte";
  import GlobalSettings from "../components/GlobalSettings.svelte";
  import AutoUpdateSettings from "../components/AutoUpdateSettings.svelte";
  import GitHubAccounts from "../components/GitHubAccounts.svelte";
  import CollapsibleGroup from "../components/CollapsibleGroup.svelte";

  let themeSetting = $state<ThemeSetting>("system");
  let showDeprecated = $state(true);
  let autoUpdateDefault = $state(true);
  let proxyAutostart = $state(false);
  let pruneLibraries = $state(true);

  let sections = $state<HomePlugins[]>([]);
  let sectionsError = $state("");
  let schemasByHome = $state<Record<string, PluginConfigSchema[]>>({});

  const appGroups = $derived(sections.filter((s) => s.home.id === "forebay" || s.home.present));

  async function loadForebaySettings(): Promise<void> {
    const [theme, deprecated, autoUpdate, autostart, prune] = await Promise.all([
      forebay.getConfig("forebay", "theme"),
      forebay.getConfig("forebay", "showDeprecated"),
      forebay.getConfig("forebay", "autoUpdateDefault"),
      forebay.getConfig("forebay", "proxyAutostart"),
      forebay.getConfig("forebay", "pruneUnusedLibraries"),
    ]);
    themeSetting = theme.ok && (theme.data === "light" || theme.data === "dark" || theme.data === "system") ? theme.data : "system";
    showDeprecated = deprecated.ok && deprecated.data === true;
    autoUpdateDefault = !(autoUpdate.ok && autoUpdate.data === false);
    proxyAutostart = autostart.ok && autostart.data === true;
    // Absent means on, which is what the sidecar assumes too.
    pruneLibraries = !(prune.ok && prune.data === false);
    applyThemeSetting(themeSetting);
  }

  // Resolving one app's plugin settings runs each of its plugin bundles, so a section pays
  // for itself only once opened. The first app starts open, which is the whole cost for the
  // common single-app case and keeps the screen useful without a click.
  let openHomes = $state<Record<string, boolean>>({});
  let loadedHomes = $state<Record<string, boolean>>({});

  async function loadAppGroups(): Promise<void> {
    const result = await forebay.pluginsList();
    if (!result.ok) {
      sectionsError = result.error;
      return;
    }
    sectionsError = "";
    // Every group needs an explicit boolean before it renders: `bind:` cannot start from an
    // absent value. Assign the flags first so the sections render already knowing their state.
    const groups = result.data.filter((s) => s.home.id === "forebay" || s.home.present);
    openHomes = Object.fromEntries(groups.map((group, index) => [group.home.id, index === 0]));
    sections = result.data;
  }

  async function loadGroup(homeId: string): Promise<void> {
    if (loadedHomes[homeId]) return;
    loadedHomes = { ...loadedHomes, [homeId]: true };
    const schemas = await forebay.configSchemas(homeId);
    if (schemas.ok) schemasByHome = { ...schemasByHome, [homeId]: schemas.data };
  }

  $effect(() => {
    for (const [homeId, open] of Object.entries(openHomes)) {
      if (open && !loadedHomes[homeId]) void loadGroup(homeId);
    }
  });

  // Whichever plugin manages this home's plugins owns the automatic-update settings, so the row
  // is found by what it PROVIDES. Forebay renders a screen for a capability, never for a plugin.
  function managerSchemaFor(homeId: string): PluginConfigSchema | null {
    return (schemasByHome[homeId] ?? []).find((s) => s.capabilities?.includes(PLUGIN_MANAGEMENT)) ?? null;
  }

  async function handleThemeChange(next: ThemeSetting): Promise<void> {
    themeSetting = next;
    applyThemeSetting(next);
    await forebay.setConfig("forebay", "theme", next);
  }

  async function handleShowDeprecatedChange(on: boolean): Promise<void> {
    showDeprecated = on;
    await forebay.setConfig("forebay", "showDeprecated", on);
  }

  async function handleAutoUpdateChange(on: boolean): Promise<void> {
    autoUpdateDefault = on;
    await forebay.setConfig("forebay", "autoUpdateDefault", on);
  }

  async function handleProxyAutostartChange(on: boolean): Promise<void> {
    proxyAutostart = on;
    await forebay.setConfig("forebay", "proxyAutostart", on);
  }

  async function handlePruneLibrariesChange(on: boolean): Promise<void> {
    pruneLibraries = on;
    await forebay.setConfig("forebay", "pruneUnusedLibraries", on);
  }

  // Every section here is a plugin's own declaration, rendered generically. Forebay keeps no
  // knowledge of which plugin contributes what.
  let contributed = $state<PluginSettingsSection[]>([]);
  const homeLabels = $derived(Object.fromEntries(sections.map((s) => [s.home.id, s.home.label])));

  async function loadContributed(): Promise<void> {
    const cached = await forebay.settingsSections();
    if (cached.ok) contributed = cached.data;
    const fresh = await forebay.settingsSections({ wait: true });
    if (fresh.ok) contributed = fresh.data;
  }

  onMount(() => {
    loadForebaySettings();
    loadAppGroups();
    loadContributed();
  });
</script>

<div class="head">
  <div>
    <h1>Settings</h1>
    <p>Appearance, marketplace defaults, and per-app plugin configuration.</p>
  </div>
</div>

<section class="category">
  <h2>Appearance</h2>
  <Card>
    <SettingRow name="Theme" description="Follow the system, or force light or dark.">
      {#snippet control()}
        <select
          class="control"
          aria-label="Theme"
          value={themeSetting}
          onchange={(event) => handleThemeChange((event.currentTarget as HTMLSelectElement).value as ThemeSetting)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      {/snippet}
    </SettingRow>
  </Card>
</section>

<section class="category">
  <h2>GitHub</h2>
  <Card>
    <GitHubAccounts />
  </Card>
</section>

<section class="category">
  <h2>Marketplace</h2>
  <Card>
    <SettingRow name="Show deprecated plugins" description="List archived repos in the marketplace so they can be installed again.">
      {#snippet control()}
        <ToggleSwitch checked={showDeprecated} label="Show deprecated plugins" onchange={handleShowDeprecatedChange} />
      {/snippet}
    </SettingRow>
  </Card>
</section>

<section class="category">
  <h2>Plugins</h2>
  <Card>
    <SettingRow name="Auto-update new installs" description="Newly installed plugins start with auto-update enabled.">
      {#snippet control()}
        <ToggleSwitch checked={autoUpdateDefault} label="Auto-update new installs" onchange={handleAutoUpdateChange} />
      {/snippet}
    </SettingRow>
  </Card>
</section>

<section class="category">
  <h2>Local API</h2>
  <Card>
    <SettingRow name="Start the local API on launch" description="Autostart the proxy daemon when Forebay opens.">
      {#snippet control()}
        <ToggleSwitch checked={proxyAutostart} label="Start the local API on launch" onchange={handleProxyAutostartChange} />
      {/snippet}
    </SettingRow>
  </Card>
</section>

<section class="category">
  <h2>Libraries</h2>
  <Card>
    <SettingRow name="Remove unused libraries" description="When the last plugin using a library is uninstalled, remove the library too.">
      {#snippet control()}
        <ToggleSwitch checked={pruneLibraries} label="Remove unused libraries" onchange={handlePruneLibrariesChange} />
      {/snippet}
    </SettingRow>
  </Card>
</section>

<section class="category">
  <h2>Advanced</h2>
  <GlobalSettings />
</section>

{#each contributed as section (section.plugin + ":" + section.id)}
  <ContributedSection {section} {homeLabels} />
{/each}

<section class="category">
  <h2>Per-app configuration</h2>
  {#if sectionsError}
    <p class="error">Could not load apps: {sectionsError}</p>
  {/if}
  {#each appGroups as group (group.home.id)}
    <div class="apphome" data-testid={"settings-home-" + group.home.id}>
      <CollapsibleGroup label={group.home.label} bind:open={openHomes[group.home.id]}>
        {#snippet body()}
          <Card>
            {#if group.home.managesPlugins}
              <div class="updates">
                <AutoUpdateSettings homeId={group.home.id} schema={managerSchemaFor(group.home.id)} />
              </div>
            {/if}
            {#each schemasByHome[group.home.id] ?? [] as schema (schema.plugin)}
              <details class="plugin">
                <summary>{schema.plugin}</summary>
                <div class="fields">
                  <PluginControls homeId={group.home.id} {schema} hideContributed />
                </div>
              </details>
            {/each}
            {#if !loadedHomes[group.home.id]}
              <p class="empty">Loading settings…</p>
            {:else if (schemasByHome[group.home.id] ?? []).length === 0}
              <p class="empty">No configurable plugins.</p>
            {/if}
          </Card>
        {/snippet}
      </CollapsibleGroup>
    </div>
  {/each}
</section>

<style>
  .updates {
    padding-bottom: var(--space-md);
    margin-bottom: var(--space-xs);
    border-bottom: var(--hairline) solid var(--border);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2xl);
    margin-bottom: var(--space-3xl);
  }
  .head h1 {
    margin: 0;
    font-size: var(--fs-xl);
    letter-spacing: -.02em;
    font-weight: 650;
  }
  .head p {
    margin: var(--space-3xs) 0 0;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .category {
    margin-bottom: var(--space-3xl);
  }
  .category h2 {
    margin: 0 var(--space-3xs) var(--space-md);
    font-size: var(--fs-md);
    font-weight: 650;
    letter-spacing: -.01em;
  }
  .apphome {
    margin-bottom: var(--space-xl);
  }
  .plugin {
    border-top: var(--hairline) solid var(--border);
  }
  .plugin:first-child {
    border-top: 0;
  }
  .plugin summary {
    cursor: pointer;
    padding: var(--space-lg) var(--space-2xl);
    font-size: var(--fs-sm);
    font-weight: 600;
    list-style: none;
  }
  .plugin summary::-webkit-details-marker {
    display: none;
  }
  .fields {
    padding-bottom: var(--space-xs);
  }
  .empty {
    margin: 0;
    padding: var(--space-2xl);
    color: var(--faint);
    font-size: var(--fs-sm);
  }
  .error {
    color: var(--crit);
    font-size: var(--fs-md);
  }
</style>
