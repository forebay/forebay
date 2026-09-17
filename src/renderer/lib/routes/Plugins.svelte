<script lang="ts">
  import { onMount } from "svelte";
  import type { HomePlugins, CatalogEntry, PluginHome, UnifiedPlugin, PluginVersion, Result, InstallManyResult, InstallOutcome, RepoRef, EngineView, GithubStatus, MarketplaceSourceStatus, MarketplaceContribution, HomePluginData, QuarantineView } from "@forebay/shared";
  import { classifyRepoName, matchesContribution, LIBRARY_KINDS, formatBytes } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { consumeParams } from "../router.js";
  import { enqueue, enqueueJob, jobSettled, activeByPlugin } from "../downloads.js";
  import { toast } from "../toast.js";
  import { debounce } from "../util/debounce.js";
  import { buildUnifiedPlugins, applicableHomeIds } from "../util/unifiedPlugins.js";
  import { prerequisiteInstalls } from "../util/installQueue.js";
  import Button from "../components/Button.svelte";
  import IconButton from "../components/IconButton.svelte";
  import SearchField from "../components/SearchField.svelte";
  import ItemBox from "../components/ItemBox.svelte";
  import ItemList from "../components/ItemList.svelte";
  import AppPills from "../components/AppPills.svelte";
  import PluginInstallControl from "../components/PluginInstallControl.svelte";
  import AddPluginDialog from "../components/AddPluginDialog.svelte";
  import MarketplacesDialog from "../components/MarketplacesDialog.svelte";
  import ConfirmDialog from "../components/ConfirmDialog.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import PluginIcon, { LOGO_SIZE } from "../components/PluginIcon.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import Chip from "../components/Chip.svelte";
  import PluginDetail from "../components/PluginDetail.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import ViewToggle from "../components/ViewToggle.svelte";
  import GitHubConnectDialog from "../components/GitHubConnectDialog.svelte";
  import { knownViewMode, loadViewMode, saveViewMode, type ViewMode } from "../viewMode.js";
  import { githubChanged, bumpGithub } from "../githubStore.js";

  const ROW_HEIGHT = 96;

  let sections = $state<HomePlugins[]>([]);
  let catalog = $state<CatalogEntry[]>([]);
  let catalogSources = $state<MarketplaceSourceStatus[]>([]);
  let contributions = $state<MarketplaceContribution[]>([]);
  let contributionFilter = $state<string>("");
  let sourceFilter = $state<string>("all");
  let catalogOrg = $state("");
  let engines = $state<EngineView[]>([]);
  let quarantine = $state<QuarantineView[]>([]);
  let versions = $state<Record<string, Record<string, PluginVersion>>>({});
  let favorites = $state<string[]>([]);
  let pluginsError = $state("");
  let loaded = $state(false);
  let catalogRateLimited = $state(false);
  let ghStatus = $state<GithubStatus | null>(null);
  let rateLimitBannerDismissed = $state(false);
  let connectDialogOpen = $state(false);
  // A plugin awaiting a real GitHub star once the user connects an account.
  let pendingStarPlugin = $state<UnifiedPlugin | null>(null);

  function versionLabelFor(p: UnifiedPlugin): string {
    return Object.values(versions[p.name] ?? {}).map((v) => v.label).find((l): l is string => !!l) ?? "";
  }

  function onExperimentalSomewhere(p: UnifiedPlugin): boolean {
    return Object.values(versions[p.name] ?? {}).some((v) => v.onExperimental);
  }

  let searchRaw = $state("");
  let search = $state("");
  const applySearch = debounce((value: string) => {
    search = value;
  }, 120);
  $effect(() => {
    applySearch(searchRaw);
  });

  const startParams = consumeParams();
  let addOpen = $state(!!startParams?.add);
  let marketplacesOpen = $state(false);
  // Arriving with ?plugin= opens that plugin straight away, so a link from another screen
  // lands on the plugin itself rather than just the list.
  let selectedName = $state<string | null>(startParams?.plugin ?? null);
  let pendingConfirm = $state<{
    title: string;
    message: string;
    confirmLabel: string;
    optIn?: string;
    optInNote?: string;
    run: (optedIn: boolean) => Promise<void>;
  } | null>(null);

  type KindFilter = "all" | "provider" | "proxy" | "plugin" | "loader" | "translator" | "engine";
  const KIND_FILTERS: KindFilter[] = ["all", "provider", "proxy", "plugin", "loader", "translator", "engine"];
  const startKind: KindFilter =
    startParams?.kind && (KIND_FILTERS as string[]).includes(startParams.kind) ? (startParams.kind as KindFilter) : "plugin";
  let kindFilter = $state<KindFilter>(startKind);
  let installedOnly = $state(false);
  let externalOnly = $state(false);
  let favoritesOnly = $state(false);
  let updatableOnly = $state(false);
  // Archived repos stay installable, they are just not what you are usually shopping for.
  // Off by default, and remembered, so asking for them once is enough.
  let showDeprecated = $state(false);

  // A plugin can be external and a kind at once, so the badge prefixes its kind
  // (the .chip style upper-cases it), e.g. "external provider" -> "EXTERNAL PROVIDER".
  function badgeLabel(p: UnifiedPlugin): string {
    const kind = p.kind === "provider" || p.kind === "proxy" || p.kind === "loader" ? p.kind : "";
    if (p.deprecated) return kind ? `deprecated ${kind}` : "deprecated";
    if (p.external) return kind ? `external ${kind}` : "external";
    return kind;
  }

  // The stored view is part of the first paint, not a correction to it: starting in list and
  // swapping to grid once the preference arrives is a visible flash of the wrong screen.
  let view = $state<ViewMode>(knownViewMode("plugins") ?? "list");
  let viewLoaded = $state(knownViewMode("plugins") !== null);
  function setView(mode: ViewMode): void {
    view = mode;
    void saveViewMode("plugins", mode);
  }

  function isInstalled(p: UnifiedPlugin): boolean {
    return Object.values(p.homes).some((h) => h.installed);
  }

  const homes = $derived(sections.map((s) => s.home));
  const engineIds = $derived(new Set(engines.map((e) => e.id)));
  const unified = $derived(buildUnifiedPlugins(sections, catalog, homes, engines.map((e) => ({ name: e.id, url: e.url })), catalogOrg, favorites));
  const counts = $derived({
    all: unified.length,
    provider: unified.filter((p) => p.kind === "provider").length,
    proxy: unified.filter((p) => p.kind === "proxy").length,
    plugin: unified.filter((p) => p.kind === "plugin").length,
    loader: unified.filter((p) => p.kind === "loader").length,
    engine: unified.filter((p) => engineIds.has(p.name)).length,
    installed: unified.filter(isInstalled).length,
    external: unified.filter((p) => p.external).length,
    favorite: unified.filter((p) => p.favorite).length,
    updatable: unified.filter((p) => behindHomesFor(p).length > 0).length,
    deprecated: unified.filter((p) => p.deprecated).length,
  });
  const filtered = $derived(
    unified.filter((p) => {
      if (kindFilter === "engine") {
        if (!engineIds.has(p.name)) return false;
      } else if (kindFilter !== "all" && p.kind !== kindFilter) {
        return false;
      }
      // A library kind is only ever surfaced by a plugin that consumes it: with nothing
      // contributing a category that matches, it is not this home's business.
      if (LIBRARY_KINDS.includes(p.kind) && !contributions.some((c) => matchesContribution(p, c))) return false;
      // A category a plugin contributed matches on the entry's own topics or kind, so it
      // keeps matching things published after the plugin that declared it.
      const contributed = contributions.find((c) => c.id === contributionFilter);
      if (contributed && !matchesContribution(p, contributed)) return false;
      // Something installed from no marketplace at all appears only under "All sources".
      if (sourceFilter !== "all" && p.sourceId !== sourceFilter) return false;
      // An installed one stays listed whatever the filter says, otherwise asking to hide
      // deprecated entries would hide something already on disk and leave no way to remove it.
      if (p.deprecated && !showDeprecated && !isInstalled(p)) return false;
      if (installedOnly && !isInstalled(p)) return false;
      if (externalOnly && !p.external) return false;
      if (favoritesOnly && !p.favorite) return false;
      if (updatableOnly && behindHomesFor(p).length === 0) return false;
      const needle = search.trim().toLowerCase();
      return !needle
        || p.name.toLowerCase().includes(needle)
        || p.displayName.toLowerCase().includes(needle)
        || p.description.toLowerCase().includes(needle)
        || p.topics.some((t) => t.toLowerCase().includes(needle));
    }),
  );
  function setKind(kind: KindFilter): void {
    kindFilter = kind;
  }

  // A contributed category is a category in its own right, not a narrowing of the kind chip:
  // picking "Translators" while "Plugins" is selected would otherwise match nothing at all.
  function selectContributed(id: string): void {
    contributionFilter = contributionFilter === id ? "" : id;
    if (contributionFilter) kindFilter = "all";
  }

  function countContributed(contribution: MarketplaceContribution): number {
    return unified.filter((p) => matchesContribution(p, contribution)).length;
  }

  // Which marketplace listed this, named the way its source is named in the filter row.
  function sourceLabel(p: UnifiedPlugin): string {
    return catalogSources.find((s) => s.id === p.sourceId)?.label ?? "";
  }

  // Each shadowed name says who won it: two entries from one source can lose to two
  // different marketplaces, so a single winner cannot be named for the whole list.
  function shadowedNames(source: MarketplaceSourceStatus): string {
    return (source.shadowed ?? []).map((entry) => `${entry.name} (listed by ${entry.by})`).join(", ");
  }
  const isFiltering = $derived(search.trim() !== "" || kindFilter !== "all" || installedOnly || externalOnly || favoritesOnly || updatableOnly);
  function clearFilters(): void {
    searchRaw = "";
    search = "";
    kindFilter = "all";
    installedOnly = false;
    externalOnly = false;
    favoritesOnly = false;
    updatableOnly = false;
  }
  const addPluginHome = $derived(homes[0]?.id ?? "forebay");
  // Only counts what an updater could actually pull, so the button never promises a
  // no-op for a plugin sitting behind in an unmanaged home.
  const anyUpdateAvailable = $derived(unified.some((p) => behindHomesFor(p).length > 0));
  // Derive from the live list by name so the open detail reflects installs/removes.
  const selectedPlugin = $derived(selectedName ? unified.find((p) => p.name === selectedName) ?? null : null);
  const showRateLimitBanner = $derived(catalogRateLimited && !!ghStatus && !ghStatus.connected && !rateLimitBannerDismissed);

  function applyPlugins(result: Awaited<ReturnType<typeof forebay.pluginsList>>): void {
    if (result.ok) {
      sections = result.data;
      pluginsError = "";
    } else {
      pluginsError = result.error;
    }
  }

  function applyCatalog(result: Awaited<ReturnType<typeof forebay.catalogList>>): void {
    if (result.ok) {
      catalog = result.data.entries;
      catalogOrg = result.data.org;
      catalogRateLimited = result.data.rateLimited;
      catalogSources = result.data.sources ?? [];
      contributions = result.data.contributions ?? [];
      if (contributionFilter && !contributions.some((c) => c.id === contributionFilter)) contributionFilter = "";
      // A source that disappeared from the config must not keep filtering the list to nothing.
      if (sourceFilter !== "all" && !catalogSources.some((s) => s.id === sourceFilter)) sourceFilter = "all";
    }
  }

  async function loadCatalog(): Promise<void> {
    applyCatalog(await forebay.catalogList());
  }

  async function loadGithubStatus(): Promise<void> {
    const result = await forebay.githubStatus();
    if (result.ok) ghStatus = result.data;
  }

  async function loadFavorites(): Promise<void> {
    const result = await forebay.favoritesList();
    if (result.ok) favorites = result.data;
  }

  // A failed read degrades to showing nothing: the quarantine notice is a bonus warning,
  // never a reason the rest of the Plugins tab fails to render.
  async function loadQuarantine(): Promise<void> {
    const result = await forebay.pluginQuarantine();
    quarantine = result.ok ? result.data : [];
  }

  // Starring is a real GitHub star, so require a connected account before adding
  // one rather than leaving a local-only favorite that never reaches GitHub.
  // Removing a favorite stays purely local and needs no account.
  async function toggleFavorite(p: UnifiedPlugin): Promise<void> {
    if (!p.favorite && !ghStatus?.connected) {
      pendingStarPlugin = p;
      connectDialogOpen = true;
      return;
    }
    await applyFavorite(p);
  }

  // Local favorite is instant and authoritative; the GitHub star is a best-effort
  // mirror fired off afterward and never blocks or reverts the local toggle.
  async function applyFavorite(p: UnifiedPlugin): Promise<void> {
    const result = await forebay.favoritesToggle(p.name);
    if (!result.ok) return;
    favorites = result.data;
    if (p.url) void forebay.githubSetStar(p.url, result.data.includes(p.name));
  }

  // Show cached versions instantly, then overwrite with the freshly computed ones
  // (a git describe per plugin) so only rows whose version changed visibly update.
  // The fresh pass runs in parallel; the cache only fills in until it arrives.
  async function loadVersions(): Promise<void> {
    let freshDone = false;
    const fresh = forebay.pluginVersionsAll().then((result) => {
      freshDone = true;
      if (result.ok) versions = result.data;
    });
    const cached = await forebay.pluginVersionsCached();
    if (!freshDone && cached.ok && Object.keys(cached.data).length > 0) versions = cached.data;
    await fresh;
  }

  // The head start is the whole row set or nothing: painting the installed rows alone left a
  // visibly half-built list that grew and reordered as the catalog and the versions landed.
  async function paintFromCache(): Promise<void> {
    if (sections.length > 0) return;
    const [rows, cached, cachedVersions] = await Promise.all([
      forebay.pluginsListCached(),
      forebay.catalogListCached(),
      forebay.pluginVersionsCached(),
    ]);
    if (sections.length > 0 || !rows.ok || rows.data.length === 0 || !cached.ok || !cached.data) return;
    sections = rows.data;
    applyCatalog({ ok: true, data: cached.data });
    if (cachedVersions.ok) versions = cachedVersions.data;
    loaded = true;
  }

  // Every fresh read is applied in one go: a screen that is already painted must not reshuffle
  // itself once per response.
  async function reload(): Promise<void> {
    const painting = paintFromCache();
    const [plugins, catalogResult, enginesResult] = await Promise.all([
      forebay.pluginsList(),
      forebay.catalogList(),
      forebay.enginesList(),
      loadFavorites(),
      loadGithubStatus(),
      loadQuarantine(),
    ]);
    await painting;
    applyPlugins(plugins);
    applyCatalog(catalogResult);
    if (enginesResult.ok) engines = enginesResult.data;
    queuedManagerHomes = new Set();
    loaded = true;
    void loadVersions();
  }

  // One-click connect from the rate-limit banner: reuses the detected gh CLI
  // token when present, otherwise opens the same "add account" dialog used
  // elsewhere. Either path reloads the catalog + status and notifies the rest
  // of the app so the titlebar's GitHub menu picks up the new account too.
  async function connectFromBanner(): Promise<void> {
    if (!ghStatus?.ghCli) {
      connectDialogOpen = true;
      return;
    }
    const result = await forebay.githubConnectGhCli(false);
    if (result.ok) await finishBannerConnect();
  }

  async function finishBannerConnect(): Promise<void> {
    connectDialogOpen = false;
    await Promise.all([loadCatalog(), loadGithubStatus()]);
    bumpGithub();
    const pending = pendingStarPlugin;
    pendingStarPlugin = null;
    if (pending && ghStatus?.connected) await applyFavorite(pending);
  }

  function dismissRateLimitBanner(): void {
    rateLimitBannerDismissed = true;
  }

  function homesById(): Record<string, PluginHome> {
    return Object.fromEntries(homes.map((h) => [h.id, h]));
  }
  function applicableHomesFor(p: UnifiedPlugin): { id: string; label: string; icon?: string; managesPlugins?: boolean }[] {
    const by = homesById();
    return Object.keys(p.homes).map((id) => ({ id, label: by[id]?.label ?? id, icon: by[id]?.icon, managesPlugins: by[id]?.managesPlugins }));
  }
  function installedMap(p: UnifiedPlugin): Record<string, boolean> {
    return Object.fromEntries(Object.entries(p.homes).map(([id, s]) => [id, s.installed]));
  }
  function notInstalledApplicable(p: UnifiedPlugin): string[] {
    return Object.entries(p.homes).filter(([, s]) => !s.installed).map(([id]) => id);
  }
  function installedApplicable(p: UnifiedPlugin): string[] {
    return Object.entries(p.homes).filter(([, s]) => s.installed).map(([id]) => id);
  }
  function isFullyInstalled(p: UnifiedPlugin): boolean {
    return notInstalledApplicable(p).length === 0;
  }
  function outcomesError(outcomes: InstallOutcome[]): string | null {
    const failed = outcomes.filter((o) => !o.ok);
    if (failed.length === 0) return null;
    return failed.map((o) => `${o.home}: ${o.error ?? "failed"}`).join("; ");
  }

  // Homes where this plugin is installed but only partly built, so it loads with pieces of
  // itself missing. A rebuild from the clone already on disk is what fixes that.
  function brokenHomesFor(p: UnifiedPlugin): string[] {
    return sections
      .filter((s) => s.rows.some((r) => r.name === p.name && (r.missingArtifacts?.length ?? 0) > 0))
      .map((s) => s.home.id);
  }

  // Which homes report this plugin as behind, from each home's own row.
  function behindHomesFor(p: UnifiedPlugin): string[] {
    return sections
      .filter((s) => s.home.managesPlugins && s.rows.some((r) => r.name === p.name && r.updateAvailable))
      .map((s) => s.home.id);
  }

  function homesLabel(homeIds: string[]): string {
    const by = homesById();
    return homeIds.map((id) => by[id]?.label ?? id).join(", ") || "none";
  }

  // A home whose manager install is already queued must not get a second row when the
  // user starts another install before the list reloads.
  let queuedManagerHomes = new Set<string>();

  async function installPrerequisites(name: string, homeIds: string[]): Promise<boolean> {
    for (const prereq of prerequisiteInstalls(name, homeIds, homes, engines)) {
      if (queuedManagerHomes.has(prereq.homeId)) continue;
      queuedManagerHomes.add(prereq.homeId);
      const queued = await enqueueJob("install", prereq.id, prereq.url, prereq.homeId);
      if (!queued.ok) {
        queuedManagerHomes.delete(prereq.homeId);
        return false;
      }
      // The manager has to be there before the plugin's own job runs, so this one is awaited.
      const settled = await jobSettled(queued.data.id);
      if (settled?.status !== "done") {
        queuedManagerHomes.delete(prereq.homeId);
        return false;
      }
    }
    return true;
  }

  async function installManyTracked(name: string, url: string, homeIds: string[]): Promise<Result<InstallManyResult>> {
    if (!(await installPrerequisites(name, homeIds))) {
      return { ok: false, error: "could not install the plugin manager" };
    }
    // One job per home, so each home shows its own progress and can be cancelled alone.
    const outcomes: InstallOutcome[] = [];
    for (const homeId of homeIds) {
      const queued = await enqueueJob("install", name, url, homeId);
      outcomes.push(queued.ok ? { home: homeId, ok: true } : { home: homeId, ok: false, error: queued.error });
    }
    const error = outcomesError(outcomes);
    return error ? { ok: false, error } : { ok: true, data: { outcomes } };
  }

  async function addHome(p: UnifiedPlugin, homeId: string): Promise<void> {
    if (!(await installPrerequisites(p.name, [homeId]))) {
      await reload();
      return;
    }
    const queued = await enqueueJob("install", p.name, p.url ?? "", homeId);
    if (queued.ok) await jobSettled(queued.data.id);
    await reload();
  }
  // A per-home update is a re-clone/pull through the same install path, routed
  // through the download queue so it shows progress like every other download.
  async function updateHome(p: UnifiedPlugin, homeId: string): Promise<void> {
    const queued = await enqueueJob("update", p.name, p.url ?? "", homeId);
    if (queued.ok) await jobSettled(queued.data.id);
    await reload();
  }
  // A repair rebuilds from the clone that is already there, so it goes through the same
  // queue as an install and shows the same progress.
  async function repairHome(p: UnifiedPlugin, homeId: string): Promise<void> {
    const queued = await enqueueJob("repair", p.name, p.url ?? "", homeId);
    if (queued.ok) await jobSettled(queued.data.id);
    await reload();
  }
  // The toggle is only true once the clone matches it, so the switch runs the update that
  // makes it so. Returns whether the write succeeded, so the switch can revert itself on failure.
  async function setChannel(p: UnifiedPlugin, homeId: string, channel: "inherit" | "stable" | "experimental"): Promise<boolean> {
    const result = await forebay.pluginsSetChannel(homeId, p.name, channel);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    const queued = await enqueueJob("update", p.name, p.url ?? "", homeId);
    if (queued.ok) await jobSettled(queued.data.id);
    await reload();
    return true;
  }
  // Through the same queue as an install, so a removal shows its progress, can be cancelled,
  // and lands in the download history instead of happening invisibly.
  async function removeHome(p: UnifiedPlugin, homeId: string, data: HomePluginData[] = []): Promise<void> {
    const queued = await enqueueJob("remove", p.name, p.url ?? "", homeId);
    if (queued.ok) await jobSettled(queued.data.id);
    else await forebay.pluginsUninstall(homeId, p.name);
    await deleteData(p, data.filter((entry) => entry.home.id === homeId));
    await reload();
  }

  // The paths were read before the uninstall, while the plugin was still there to declare
  // them; deleting them afterwards means the same list serves the queued per-home removal
  // and the direct remove-everywhere alike.
  async function deleteData(p: UnifiedPlugin, data: HomePluginData[]): Promise<void> {
    for (const entry of data) {
      const result = await forebay.pluginsRemoveData(entry.home.id, entry.entries.map((file) => file.path));
      if (!result.ok) toast.error(`${p.displayName}: ${result.error}`);
    }
  }

  // What the plugin would leave behind, so the confirmation can name it instead of asking
  // about "config data" in the abstract. A read that fails offers nothing rather than
  // blocking the uninstall.
  async function dataToOffer(p: UnifiedPlugin): Promise<HomePluginData[]> {
    const result = await forebay.pluginsData(p.name);
    return result.ok ? result.data : [];
  }

  function dataSummary(data: HomePluginData[]): string {
    const files = data.reduce((total, entry) => total + entry.entries.length, 0);
    const bytes = data.reduce((total, entry) => total + entry.entries.reduce((sum, file) => sum + file.bytes, 0), 0);
    const where = data.map((entry) => entry.home.label).join(", ");
    return `${files} file${files === 1 ? "" : "s"} (${formatBytes(bytes)}) in ${where}`;
  }
  // Install/update home-by-home (each its own queued task) and reload after each,
  // so a plugin's pills and button reflect every home as soon as it finishes
  // rather than waiting for the whole multi-home batch to complete.
  // Every home is queued up front so each row shows "queued" straight away; awaiting one
  // home before queueing the next left the later rows looking untouched.
  async function handleInstallAll(p: UnifiedPlugin): Promise<void> {
    const homeIds = notInstalledApplicable(p);
    if (!(await installPrerequisites(p.name, homeIds))) {
      await reload();
      return;
    }
    const ids: string[] = [];
    for (const homeId of homeIds) {
      const queued = await enqueueJob("install", p.name, p.url ?? "", homeId);
      if (queued.ok) ids.push(queued.data.id);
    }
    await reload();
    await Promise.all(ids.map((id) => jobSettled(id)));
    await reload();
  }

  let checking = $state(false);
  let updatingAll = $state(false);

  // Only a home with an updater can check or pull, so nothing here is offered without one.
  const updatesEnabled = $derived(homes.some((h) => h.managesPlugins));
  function updatableHomes(): PluginHome[] {
    return homes.filter((h) => h.managesPlugins && (h.id === "forebay" || h.present));
  }

  // A check refreshes the update cache every badge is read from, so the rows are
  // reloaded straight after.
  async function handleCheckUpdates(): Promise<void> {
    if (checking) return;
    checking = true;
    try {
      for (const home of updatableHomes()) await forebay.updatesCheck(home.id);
      applyPlugins(await forebay.pluginsList());
    } finally {
      checking = false;
    }
  }

  async function handleUpdateAll(): Promise<void> {
    if (updatingAll) return;
    updatingAll = true;
    try {
      for (const home of updatableHomes()) await forebay.updatesAll(home.id);
      applyPlugins(await forebay.pluginsList());
    } finally {
      updatingAll = false;
    }
  }

  async function handleUpdate(p: UnifiedPlugin): Promise<void> {
    const ids: string[] = [];
    for (const homeId of installedApplicable(p)) {
      const queued = await enqueueJob("update", p.name, p.url ?? "", homeId);
      if (queued.ok) ids.push(queued.data.id);
    }
    await reload();
    await Promise.all(ids.map((id) => jobSettled(id)));
    await reload();
  }
  async function handleRemoveEverywhere(p: UnifiedPlugin): Promise<void> {
    const homeIds = installedApplicable(p);
    const result = await enqueue({
      label: `Remove ${p.displayName} everywhere`,
      home: homesLabel(homeIds) || "all homes",
      run: () => forebay.pluginsRemoveEverywhere(p.name),
      summarizeFailure: (data) => outcomesError(data.outcomes),
    });
    if (result.ok) toast.success(`${p.displayName} removed`);
    else toast.error(result.error);
    await reload();
  }
  async function confirmRemoveEverywhere(p: UnifiedPlugin): Promise<void> {
    const data = await dataToOffer(p);
    pendingConfirm = {
      title: "Remove everywhere?",
      message: `Remove ${p.displayName} from every app it's installed in? This can't be undone.`,
      confirmLabel: "Remove everywhere",
      ...(data.length > 0 ? { optIn: "Also delete its settings and logs", optInNote: dataSummary(data) } : {}),
      run: async (deleteToo) => {
        await handleRemoveEverywhere(p);
        if (deleteToo) await deleteData(p, data);
      },
    };
  }

  async function confirmRemoveHome(p: UnifiedPlugin, homeId: string): Promise<void> {
    const data = (await dataToOffer(p)).filter((entry) => entry.home.id === homeId);
    if (data.length === 0) {
      await removeHome(p, homeId);
      return;
    }
    pendingConfirm = {
      title: `Remove from ${data[0].home.label}?`,
      message: `Remove ${p.displayName} from ${data[0].home.label}.`,
      confirmLabel: "Remove",
      optIn: "Also delete its settings and logs",
      optInNote: dataSummary(data),
      run: (deleteToo) => removeHome(p, homeId, deleteToo ? data : []),
    };
  }
  async function installFromUrl(repo: RepoRef): Promise<Result<unknown>> {
    const kind = classifyRepoName(repo.repo) ?? "plugin";
    const homeIds = applicableHomeIds(kind, homes, repo.repo);
    return installManyTracked(repo.repo, repo.url, homeIds);
  }

  async function toggleDeprecated(): Promise<void> {
    showDeprecated = !showDeprecated;
    await forebay.setConfig("forebay", "showDeprecated", showDeprecated);
  }

  onMount(() => {
    reload();
    loadViewMode("plugins").then((mode) => { view = mode; viewLoaded = true; });
    forebay.getConfig("forebay", "showDeprecated").then((r) => {
      showDeprecated = r.ok && r.data === true;
    });
  });

  // Refresh the catalog whenever the titlebar's GitHub menu changes the active
  // account (a token change affects which repos/manifests the catalog can see).
  // Skip the initial fire; onMount's reload() already covers first load.
  let sawInitialGithubChange = false;
  $effect(() => {
    $githubChanged;
    if (!sawInitialGithubChange) {
      sawInitialGithubChange = true;
      return;
    }
    loadCatalog();
    loadGithubStatus();
  });
</script>

<PageHeader title="Plugins" subtitle="Every provider, proxy, and plugin across your apps, in one place." />

{#if pluginsError}
  <ErrorState message={`Could not load plugins: ${pluginsError}`} onRetry={reload} />
{:else if !loaded || !viewLoaded}
  <div class="skeletons">
    {#each Array(5) as _}
      <Skeleton height="46px" radius="10px" />
    {/each}
  </div>
{:else}
  <div class="toolbar">
    <SearchField bind:value={searchRaw} placeholder="Search plugins…" />
    {#if updatesEnabled}
      <IconButton name="refresh" title="Check for updates" disabled={checking} onclick={handleCheckUpdates} />
      {#if anyUpdateAvailable}
        <Button onclick={handleUpdateAll} disabled={updatingAll}>{updatingAll ? "Updating..." : "Update all"}</Button>
      {/if}
    {/if}
    <Button onclick={() => (marketplacesOpen = true)}>Marketplaces</Button>
    <Button variant="primary" onclick={() => (addOpen = true)}>+ Add from URL</Button>
    <ViewToggle value={view} onChange={setView} />
  </div>

  <div class="filters">
    <Chip label={`All ${counts.all}`} on={kindFilter === "all"} onclick={() => setKind("all")} />
    <Chip label={`Providers ${counts.provider}`} on={kindFilter === "provider"} onclick={() => setKind("provider")} />
    <Chip label={`Proxies ${counts.proxy}`} on={kindFilter === "proxy"} onclick={() => setKind("proxy")} />
    <Chip label={`Plugins ${counts.plugin}`} on={kindFilter === "plugin"} onclick={() => setKind("plugin")} />
    <Chip label={`Loaders ${counts.loader}`} on={kindFilter === "loader"} onclick={() => setKind("loader")} />
    <Chip label={`Engines ${counts.engine}`} on={kindFilter === "engine"} onclick={() => setKind("engine")} />
    <span class="sep"></span>
    <Chip label={`Installed ${counts.installed}`} on={installedOnly} onclick={() => (installedOnly = !installedOnly)} />
    <Chip label={`Updates ${counts.updatable}`} on={updatableOnly} onclick={() => (updatableOnly = !updatableOnly)} />
    <Chip label={`External ${counts.external}`} on={externalOnly} onclick={() => (externalOnly = !externalOnly)} />
    <Chip label={`Favorites ${counts.favorite}`} on={favoritesOnly} onclick={() => (favoritesOnly = !favoritesOnly)} />
    {#if counts.deprecated > 0}
      <Chip label={`Deprecated ${counts.deprecated}`} on={showDeprecated} onclick={toggleDeprecated} />
    {/if}
  </div>

  <!-- Categories installed plugins asked for. Forebay names none of them itself. -->
  {#if contributions.length > 0}
    <div class="filters" data-testid="contributed-filters">
      <span class="fromlabel">From installed plugins</span>
      {#each contributions as contribution (contribution.id)}
        <Chip
          label={`${contribution.label} ${countContributed(contribution)}`}
          title={`Added by ${contribution.contributedBy}`}
          on={contributionFilter === contribution.id}
          onclick={() => selectContributed(contribution.id)}
        />
      {/each}
    </div>
  {/if}

  <!-- Only worth a row of its own once there is more than one marketplace to choose between. -->
  {#if catalogSources.length > 1}
    <div class="filters" data-testid="source-filters">
      <Chip label="All sources" on={sourceFilter === "all"} onclick={() => (sourceFilter = "all")} />
      {#each catalogSources as source (source.id)}
        <Chip
          label={source.ok ? `${source.label} ${source.entryCount}` : `${source.label} unavailable`}
          on={sourceFilter === source.id}
          onclick={() => (sourceFilter = source.id)}
        />
      {/each}
    </div>
  {/if}

  {#each catalogSources.filter((s) => !s.ok) as source (source.id)}
    <p class="source-error">Could not read the {source.label} marketplace: {source.error}</p>
  {/each}

  {#each catalogSources.filter((s) => s.shadowed?.length) as source (source.id)}
    <p class="source-error" data-testid="source-shadowed">
      {source.label} also publishes {shadowedNames(source)}. Sources higher in the list win, so
      {source.label}'s {source.shadowed?.length === 1 ? "copy is" : "copies are"} hidden.
    </p>
  {/each}

  {#if showRateLimitBanner}
    <div class="ratelimit-banner">
      <span>GitHub's anonymous rate limit was reached. Installing still works; connect a GitHub account to keep browsing the catalog.</span>
      <div class="ratelimit-actions">
        <Button onclick={connectFromBanner}>
          {ghStatus?.ghCli ? `Connect @${ghStatus.ghCli.login}` : "Connect GitHub account"}
        </Button>
        <button class="dismiss" title="Dismiss" aria-label="Dismiss" onclick={dismissRateLimitBanner}>×</button>
      </div>
    </div>
  {/if}

  {#if quarantine.length > 0}
    <div class="quarantine">
      {#each quarantine as record (record.homeId + record.pluginId)}
        <div class="quarantine-item">
          <p class="quarantine-title">{record.pluginId} is not running in {record.homeLabel}</p>
          <p class="quarantine-detail">{record.detail}</p>
          <p class="quarantine-fix">{record.fix}</p>
        </div>
      {/each}
    </div>
  {/if}

  {#snippet favoriteButton(p: UnifiedPlugin)}
    <button
      type="button"
      class="favorite"
      class:on={p.favorite}
      title={p.favorite ? "Unfavorite" : "Favorite"}
      aria-label={p.favorite ? "Unfavorite" : "Favorite"}
      onclick={(e) => { e.stopPropagation(); toggleFavorite(p); }}
    >
      {p.favorite ? "★" : "☆"}
    </button>
  {/snippet}

  {#snippet installActions(p: UnifiedPlugin)}
    <div class="ctlw">
      <PluginInstallControl
        block
        plugin={p}
        homes={applicableHomesFor(p)}
        activity={$activeByPlugin[p.name] ?? null}
        updateAvailable={p.updateAvailable}
        {updatesEnabled}
        behindHomes={behindHomesFor(p)}
        brokenHomes={brokenHomesFor(p)}
        onUpdate={() => handleUpdate(p)}
        onRepairHome={(homeId) => repairHome(p, homeId)}
        onUpdateHome={(homeId) => updateHome(p, homeId)}
        onInstallAll={() => handleInstallAll(p)}
        onRemoveEverywhere={() => confirmRemoveEverywhere(p)}
        onToggleHome={(homeId, on) => (on ? addHome(p, homeId) : confirmRemoveHome(p, homeId))}
      />
    </div>
  {/snippet}

  {#snippet pluginBox(p: UnifiedPlugin, mode: ViewMode)}
    <ItemBox
      view={mode}
      testid={"plugin-" + p.name}
      title={p.displayName}
      subtitle={p.description}
      openLabel={`View ${p.displayName}`}
      onOpen={() => (selectedName = p.name)}
    >
      {#snippet icon()}
        <PluginIcon icon={p.icon} name={p.displayName} kind={p.kind} size={LOGO_SIZE.list} />
      {/snippet}
      {#snippet badges()}
        {#if mode === "list" && p.displayName !== p.name}<span class="repo">{p.name}</span>{/if}
        {#if versionLabelFor(p)}<span class="ver">{versionLabelFor(p)}</span>{/if}
        {#if badgeLabel(p)}
          <span class="chip" title={p.external ? "Installed from a repo outside the marketplace org" : undefined}>{badgeLabel(p)}</span>
        {/if}
        {#if onExperimentalSomewhere(p)}<span class="chip" title="Tracking the experimental channel">experimental</span>{/if}
        {#if catalogSources.length > 1 && sourceLabel(p)}<span class="src">{sourceLabel(p)}</span>{/if}
      {/snippet}
      {#snippet meta()}
        {#if mode === "list" && p.topics.length > 0}
          <span class="topics">
            {#each p.topics.slice(0, 4) as topic (topic)}
              <span class="topic" data-testid="topic">{topic}</span>
            {/each}
          </span>
        {/if}
      {/snippet}
      {#snippet corner()}
        {@render favoriteButton(p)}
      {/snippet}
      {#snippet actions()}
        {#if mode === "list" && applicableHomesFor(p).length > 1}
          <AppPills
            apps={applicableHomesFor(p)}
            values={installedMap(p)}
            onToggle={(homeId, on) => (on ? addHome(p, homeId) : confirmRemoveHome(p, homeId))}
          />
        {/if}
        {@render installActions(p)}
      {/snippet}
    </ItemBox>
  {/snippet}

  {#snippet emptyState()}
    {#if unified.length === 0}
      <EmptyState message="No plugins found." />
    {:else if filtered.length === 0 && isFiltering}
      <EmptyState message="No plugins match your filters." actionLabel="Clear filters" onAction={clearFilters} />
    {/if}
  {/snippet}

  <ItemList
    items={filtered}
    key={(plugin) => plugin.name}
    {view}
    rowHeight={ROW_HEIGHT}
    testid={view === "grid" ? "plugins-grid" : "plugins-list"}
  >
    {#snippet item(plugin)}{@render pluginBox(plugin, view)}{/snippet}
    {#snippet empty()}{@render emptyState()}{/snippet}
  </ItemList>

  {#if addOpen}
    <AddPluginDialog home={addPluginHome} install={installFromUrl} onClose={() => (addOpen = false)} onInstalled={reload} />
  {/if}

  {#if marketplacesOpen}
    <MarketplacesDialog onClose={() => (marketplacesOpen = false)} onSaved={loadCatalog} />
  {/if}

  {#if selectedPlugin}
    <PluginDetail
      plugin={selectedPlugin}
      homes={applicableHomesFor(selectedPlugin)}
      brokenHomes={brokenHomesFor(selectedPlugin)}
      activity={$activeByPlugin[selectedPlugin.name] ?? null}
      onClose={() => (selectedName = null)}
      onInstallAll={() => handleInstallAll(selectedPlugin)}
      onRemoveEverywhere={() => confirmRemoveEverywhere(selectedPlugin)}
      onUpdate={() => handleUpdate(selectedPlugin)}
      onRepairHome={(homeId) => repairHome(selectedPlugin, homeId)}
      onUpdateHome={(homeId) => updateHome(selectedPlugin, homeId)}
      onSetChannel={(homeId, channel) => setChannel(selectedPlugin, homeId, channel)}
      onToggleHome={(homeId, on) => (on ? addHome(selectedPlugin, homeId) : confirmRemoveHome(selectedPlugin, homeId))}
      onToggleFavorite={() => toggleFavorite(selectedPlugin)}
      onChanged={reload}
    />
  {/if}

  {#if connectDialogOpen}
    <GitHubConnectDialog mode="add" onCancel={() => { connectDialogOpen = false; pendingStarPlugin = null; }} onDone={finishBannerConnect} />
  {/if}

  {#if pendingConfirm}
    <ConfirmDialog
      title={pendingConfirm.title}
      message={pendingConfirm.message}
      confirmLabel={pendingConfirm.confirmLabel}
      danger
      optIn={pendingConfirm.optIn ?? ""}
      optInNote={pendingConfirm.optInNote ?? ""}
      onConfirm={async (optedIn) => { const p = pendingConfirm; pendingConfirm = null; if (!p) return; await p.run(optedIn); }}
      onCancel={() => (pendingConfirm = null)}
    />
  {/if}
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 2px 12px;
    flex-wrap: wrap;
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 2px 14px;
    flex-wrap: wrap;
  }
  .filters .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 3px;
  }
  .ratelimit-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    margin: 0 2px 14px;
    border-radius: 10px;
    background: var(--accent-weak);
    border: 1px solid var(--accent-border);
    font-size: 12.5px;
    color: var(--text);
  }
  .ratelimit-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .ratelimit-banner .dismiss {
    all: unset;
    cursor: pointer;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--muted);
    font-size: 14px;
  }
  .ratelimit-banner .dismiss:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .repo {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
  }
  .fromlabel {
    font-size: var(--fs-xs);
    color: var(--faint);
    align-self: center;
  }
  .source-error {
    margin: 0 0 var(--space-md);
    color: var(--warn);
    font-size: var(--fs-sm);
  }
  .quarantine {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    margin: 0 var(--space-3xs) var(--space-xl);
  }
  .quarantine-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    padding: var(--space-md) var(--space-lg);
    border: 1px solid var(--crit);
    border-radius: var(--radius-sm);
    background: var(--crit-weak);
  }
  .quarantine-title {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 650;
    color: var(--text);
  }
  .quarantine-detail {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text);
  }
  .quarantine-fix {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .src {
    font-size: var(--fs-xs);
    color: var(--faint);
    border: var(--hairline) solid var(--border);
    border-radius: var(--radius-xs);
    padding: 0 var(--space-2xs);
  }
  .ver {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--accent);
    background: var(--accent-weak);
    border-radius: 5px;
    padding: 1px 6px;
    flex: none;
  }
  .chip {
    font-size: 10.5px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--faint);
    background: var(--surface-2);
    padding: 2px 7px;
    border-radius: 20px;
  }
  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 4px;
  }
  .topic {
    font-size: 10px;
    color: var(--faint);
    background: var(--surface-2);
    padding: 1px 7px;
    border-radius: 20px;
  }
  .favorite {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--faint);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .favorite:hover {
    background: var(--surface-2);
    color: var(--muted);
  }
  .favorite.on {
    color: #e3b341;
  }
  .favorite:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .ctlw {
    width: 172px;
    flex: none;
  }
</style>

