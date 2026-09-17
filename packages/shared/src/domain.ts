export type { AccountView, AccountQuota, AccountStatus } from "@intisy-ai/basekit/auth";
export type { Impact, ActivityRecord, ActivityQuery, ActivityStats, ActivityHomeStats, FieldType, FieldSpec, ActionSpec, SectionSpec, ResolvedSection, DataSpec } from "@intisy-ai/basekit";
// A union a plugin's contract defines is taken from core, never restated: a hand-copied one
// type-checks on the day it is written and then silently narrows as the contract grows.
import type { FieldSpec, ActionSpec, SectionSpec, ResolvedSection, DataSpec, Align, Pad, Scope, Tone } from "@intisy-ai/basekit";

/**
 * The capability whose provider manages a home's plugins.
 *
 * @remarks
 * A plain id rather than the typed key core mints, because a browser surface selects by it and must
 * not link the library that mints it. Every surface that renders a screen for plugin management
 * finds its plugin through this, never by name.
 */
export const PLUGIN_MANAGEMENT = "plugin-management";

// What an update run did, as the dashboard reports it back to the renderer.
export interface UpdateSummary {
  updated: string[];
  skipped: string[];
  failed: string[];
  checkedAt: string;
}
export type { Chain, ModelMap, CatalogEntry as ModelCatalogEntry } from "@intisy-ai/basekit/proxy";
import type { ModelMap, CatalogEntry as ModelCatalogEntry } from "@intisy-ai/basekit/proxy";
import type { AppDescriptor } from "@intisy-ai/basekit";
// A translator is installable in its own right, not only a library a plugin vendors: a
// provider that speaks a vendor wire format resolves it from the home's shared store.
export type CatalogKind = "provider" | "proxy" | "plugin" | "loader" | "translator";
// Kinds that exist to be CONSUMED by another plugin rather than installed for their own sake.
// Nothing surfaces them on its own: they appear only under a category an installed plugin
// contributed, so a home with nothing that consumes them is not offered them at all.
export const LIBRARY_KINDS: CatalogKind[] = ["translator"];
export type CatalogEntry = { name: string; url: string; kind: CatalogKind; description: string; deprecated: boolean; topics: string[]; displayName?: string; icon?: string; app?: AppDescriptor; apps?: string[]; sourceId?: string };
export type RepoMeta = { owner: string; repo: string; htmlUrl: string; stars: number | null; description: string; topics: string[]; readme: string | null };
export type CatalogTokenSource = "env" | "config" | "anonymous";

// Where entries come from. A GitHub org is one kind of marketplace, not the only one: a
// manifest names its entries outright (a URL, or a directory for one that is not published).
export type MarketplaceSourceType = "github-org" | "manifest" | "local";
export type MarketplaceSource = {
  id: string;
  label: string;
  type: MarketplaceSourceType;
  enabled?: boolean;
  // github-org
  org?: string;
  // manifest
  url?: string;
  // local
  path?: string;
};
// An entry this source published that a higher-priority source had already claimed, and the
// marketplace whose copy is listed instead.
export type ShadowedEntry = { name: string; by: string };
// What one source contributed to a listing. A source that failed says so here and the others
// still list: one unreachable marketplace must never read as an empty catalog.
export type MarketplaceSourceStatus = { id: string; label: string; type: MarketplaceSourceType; ok: boolean; entryCount: number; error?: string; shadowed?: ShadowedEntry[] };
// A category an installed plugin adds to the marketplace. It states a MATCH rather than a list
// of entries, so anything published later that fits appears without updating the plugin that
// declared it.
export type MarketplaceContribution = {
  id: string;
  label: string;
  match: { topics?: string[]; kind?: CatalogKind };
  contributedBy: string;
};
export type CatalogResult = { entries: CatalogEntry[]; source: CatalogTokenSource; org: string; rateLimited: boolean; sources: MarketplaceSourceStatus[]; contributions?: MarketplaceContribution[] };
export type GithubAccountView = { login: string; name: string | null; avatarUrl: string | null };
export type GithubStatus = {
  source: CatalogTokenSource;
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  ghCliDetected: boolean;
  ghCli: GithubAccountView | null;
  accounts: GithubAccountView[];
  activeLogin: string | null;
  forebayRepoUrl: string;
  forebayStarred: boolean | null;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type ProviderHealth = {
  provider: string;
  accounts: number;
  quotaMinPct: number | null;
};
export type OverviewSummary = {
  providersConnected: number;
  accountsTotal: number;
  accountsEnabled: number;
  appsDetected: number;
  pluginsInstalled: number;
  providerHealth: ProviderHealth[];
  serverRunning: boolean;
  serverPort: number;
};
export type ProxyStatus = {
  running: boolean;
  port: number;
};
export type ProxyView = { name: string; app: string; appLabel: string; enabled: boolean; setup?: string };
export type ProviderAuthKind = "oauth" | "api-key";
export type ProviderRow = {
  id: string;
  label: string;
  authKind: ProviderAuthKind;
  accountCount: number;
  // True once the provider is exposed to at least one app.
  enabled: boolean;
  exposure: Record<string, boolean>;
  translator?: string;
  // Account store key this provider reads/writes; equals `id` unless it shares
  // a pool with sibling providers from the same or another plugin.
  accountPool: string;
  // Other provider ids that share this provider's accountPool, empty otherwise.
  sharedWith: string[];
  // The deploying plugin's repo/bundle name, used to target its settings.
  pluginName: string;
  // The provider's own mark where its plugin declared one, else the plugin's; absent when
  // neither exists, which is what the lettermark is for.
  icon?: string;
  // Why this provider's handler bundle yielded no metadata, when it failed to load.
  // Everything the row shows apart from the account count is a fallback while set.
  defsError?: string;
};
export type RoutingState = {
  tiers: string[];
  map: ModelMap;
  catalog: ModelCatalogEntry[];
};
export type AppPresence = Record<string, boolean>;
export type HostApp = { id: string; label: string; icon?: string };
export type AppConnection = { app: string; cliPresent: boolean; loaderId: string | null; loaderUrl: string | null; loaderInstalled: boolean };
export type CliResult = {
  stdout: string;
  stderr: string;
};
export type PluginRow = {
  name: string;
  // The manifest id its own plugin.json declares, when the row is a git clone with one; absent
  // otherwise. This is the ledger's identity space, which is not always `name` (the plugins.json
  // entry / clone directory name).
  pluginId?: string;
  kind: "git" | "npm";
  enabled: boolean;
  url?: string;
  installedVersion?: string | null;
  updateAvailable: boolean;
  description: string;
  displayName?: string;
  icon?: string;
  // Files the clone declares that its build did not produce; a non-empty list means the
  // plugin is installed but only partly built, and a repair is what fixes it.
  missingArtifacts?: string[];
  // Whether the plugin is actually present in this home. A home's config DECLARES what should
  // be installed, and the manager clones anything named there that is missing, so an entry
  // with no clone behind it is an install that has not happened yet (or failed), not an
  // install. Either way it is not there now.
  present: boolean;
};
export type UsageAccount = {
  provider: string;
  id: string;
};
export type UsageSessionSource = string;
export type UsageTokens = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};
export type UsageDay = {
  tokens: number;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  messageCount: number;
};
export type UsageSessionModel = {
  id: string;
  provider: string;
  tokens: number;
};
export type UsageSession = {
  id: string;
  title: string;
  // The project the session belongs to, shown beside the title rather than as it.
  project?: string;
  tokens: UsageTokens;
  messageCount: number;
  source: UsageSessionSource;
  updated: number;
  costByDay: Record<string, UsageDay>;
  models: UsageSessionModel[];
};
export type UsageModel = {
  provider: string;
  tokens: { input: number; output: number; reasoning: number };
  sessionCount: number;
  messageCount: number;
  estimatedCostUsd?: number;
  priced?: boolean;
};
export type UsageSnapshot = {
  accounts: UsageAccount[];
  sessions: UsageSession[];
  models: Record<string, UsageModel>;
  updatedAt: string;
  estimatedCostUsd?: number;
  pricedModels?: number;
  unpricedModels?: number;
  pricesUpdatedAt?: string;
};
export type ImportableApp = { app: string; label: string; hasConfig: boolean };
export type ImportSummary = { accounts: number; providers: number; routingImported: boolean; notes: string[] };
export type ImportSelection = { accounts: boolean; routing: boolean; exposure: boolean };
export type ImportPreview = { accounts: number; routingSlots: number | null; exposedProviders: number };
export type RoutingApp = { app: string; label: string };

// A unit of plugin work the sidecar runs one at a time in its own process. The renderer
// mirrors this list rather than keeping a queue of its own, so cancel and per-home status
// survive a reload.
export type JobKind = "install" | "update" | "remove" | "repair";
export type JobStatus = "queued" | "running" | "cancelling" | "done" | "failed" | "cancelled";
export type JobPhase = { name: string; ms: number };
// One throughput reading, kept so a screen can chart the transfer rate over time.
export type JobSample = { ts: number; bytesPerSecond: number };
export type JobSpec = { kind: JobKind; plugin: string; url: string; home: string };
export type Job = JobSpec & {
  id: string;
  status: JobStatus;
  phase: string;
  // Coarse phase-based progress 0..100; -1 means no phase has been reported yet.
  percent: number;
  phases: JobPhase[];
  // Real transfer figures, read from git's own progress output; absent when nothing is
  // transferring (a build reports no bytes).
  bytes?: number;
  bytesPerSecond?: number;
  samples: JobSample[];
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  phaseStartedAt?: number;
  fromVersion?: string;
  toVersion?: string;
  error?: string;
};

export type PluginHomeId = string;
export type PluginHome = {
  id: PluginHomeId;
  label: string;
  icon?: string;
  dir: string;
  present: boolean;
  managesPlugins: boolean;
  // The loader plugin that connects this app, straight from the app registry. A loader only
  // ever serves the one app that names it, so this is how a home claims its own loader.
  loaderId?: string;
  // Whether that loader is actually installed here. Without it the app loads nothing the
  // ecosystem installs, so offering it as a target promises something that cannot work.
  loaderInstalled?: boolean;
};
export type HomePlugins = { home: PluginHome; rows: PluginRow[] };
export type LedgerRowView = {
  pluginId: string;
  status: string;
  capabilitiesDeclared: string[];
  capabilities: string[];
  provides: string[];
  consumes: string[];
  unresolved: string[];
  topics: string[];
  permissions: string[];
  error?: { detail: string; fix: string };
};
export type HomeLedger = { home: PluginHome; rows: LedgerRowView[] };
export type QuarantineView = { homeId: string; homeLabel: string; pluginId: string; detail: string; fix: string };
// The four storage subdirectory names an app home carries, and where they land.
export type AppPathNames = { repos: string; plugin: string; cache: string; config: string };
export type AppStorage = { app: string; home: string; names: AppPathNames; defaults: AppPathNames; resolved: AppPathNames };
export type PathMove = { kind: keyof AppPathNames; from: string; to: string; status: "moved" | "nothing-to-move" | "target-exists" | "failed"; detail?: string };
export type AppStorageResult = { names: AppPathNames; moves: PathMove[] };
// A package resolvable from a home. `usedBy` names the plugins that declare a shared
// library, and is empty for a plugin's own dependency, which has exactly one user.
export type InstalledLibrary = { specifier: string; version: string; usedBy: string[] };
export type PluginDependencies = { plugin: string; dependencies: InstalledLibrary[] };
export type HomeLibraries = { home: PluginHome; shared: InstalledLibrary[]; plugins: PluginDependencies[] };
// One library across every home, which is how it is listed: the homes sit beside it rather than
// the library being repeated once per home. Versions are per home because they can differ.
export type UnifiedLibrary = {
  specifier: string;
  // usedBy is per home because a library can be load-bearing in one and left over in
  // another; only the home's own answer says whether it is safe to remove there.
  homes: Record<string, { version: string; installed: boolean; usedBy: string[] }>;
  // Plugins that declare it in any home, whether or not it reached the shared store.
  usedBy: string[];
  declaredBy: string[];
};
// "unknown" is distinct from "current": a home whose clone could not be read has no answer,
// and rendering that as up to date is what made stale badges look authoritative.
export type UpdateState = "current" | "behind" | "unknown";
export type PluginVersion = {
  kind: "git" | "npm";
  label: string | null;
  updateState: UpdateState;
  autoUpdate: boolean;
  // When this home's update cache was last written, so a day-old answer can read as day-old.
  checkedAt?: string | null;
  onExperimental: boolean;
  // null means the channel branch has not been confirmed either way, and the switch is not offered.
  experimentalAvailable: boolean | null;
  // The plugins.json entry's own declared channel, straight from disk. Absent for an npm-kind
  // plugin or an entry that names none, which is not the same as "inherit": only a declared
  // value belongs here, so the renderer can tell inherit apart from an explicit stable.
  channel?: "inherit" | "stable" | "experimental";
};
export type EngineHomeState = { installed: boolean; enabled: boolean };
export type EngineView = { id: string; capability: string; url: string; homes: Record<string, EngineHomeState> };
export type UnifiedHomeState = { installed: boolean; version?: string | null };
export type UnifiedPlugin = {
  name: string;
  // The ledger's own identity for this plugin (see PluginRow.pluginId), resolved from whichever
  // home has it installed. Absent when nothing installed has ever resolved one, in which case
  // `name` is the only identity there is.
  pluginId?: string;
  kind: CatalogKind;
  description: string;
  url?: string;
  updateAvailable: boolean;
  homes: Record<string, UnifiedHomeState>;
  topics: string[];
  displayName: string;
  icon: string;
  // True when the plugin's repo owner is not the configured marketplace org, i.e.
  // it was installed from an outside source rather than the trusted catalog.
  external: boolean;
  // The apps this plugin declares it suits. Empty means it declares nothing, which is read
  // as suiting any app rather than none.
  apps?: string[];
  favorite: boolean;
  // The repo is archived upstream. Still installable, just kept out of the list unless
  // asked for, or unless it is already installed somewhere and needs managing.
  deprecated: boolean;
  // Which configured marketplace listed this. Absent for something installed from outside
  // every marketplace, which is the same thing `external` reports from the URL's owner.
  sourceId?: string;
};
export type InstallOutcome = { home: string; ok: boolean; error?: string };
export type InstallManyResult = { outcomes: InstallOutcome[] };
// Pushed from the sidecar during an install so a download row can show its live
// step; id correlates to the caller's download-task id. percent is coarse
// phase-based progress 0..100 (-1 when indeterminate).
export type DownloadProgress = { id: number; step: string; percent: number };
export type PluginConfigSchema = {
  plugin: string;
  defaults: Record<string, unknown>;
  current: Record<string, unknown>;
  fields?: FieldSpec[];
  actions?: ActionSpec[];
  sections?: SectionSpec[];
  data?: DataSpec;
  // How the declaration splits into contributed sections and what no section claimed.
  // Resolved in the sidecar by core, so every surface splits a declaration the same way
  // and the renderer never has to know the rule.
  layout?: PluginLayout;
  // What this plugin declares it provides in this home. A surface with a screen for a
  // capability finds the plugin behind it here, rather than by knowing its name.
  capabilities?: string[];
};
// One thing a plugin left behind in a home, relative to that home. `declared` marks a path
// the plugin named itself rather than one core's naming found.
export type PluginDataEntry = { path: string; bytes: number; declared?: boolean };
export type HomePluginData = { home: PluginHome; entries: PluginDataEntry[] };
export type PluginLayout = { sections: ResolvedSection[]; fields: FieldSpec[]; actions: ActionSpec[] };
export interface NodeStyle {
  width?: string;
  grow?: number;
  align?: Align;
  pad?: Pad;
  tone?: string;
}

export interface ScreenNode {
  kind: string;
  style?: NodeStyle;
  children?: ScreenNode[];
  [prop: string]: unknown;
}

export interface Column {
  key: string;
  label?: string;
  tone?: Tone;
  truncate?: number;
}

export interface ItemShape {
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: string;
}

export interface PluginScreen {
  plugin: string;
  id: string;
  label: string;
  glyph?: string;
  order?: number;
  scope?: Scope;
  refreshOn?: string[];
  layout: ScreenNode;
  homes: string[];
}

export interface ScreenData {
  sources: Record<string, unknown>;
}

export interface InvokeResult {
  ok: boolean;
  message?: string;
  refresh?: boolean;
}
// One contributed settings section, folded across every home that offers it. The controls
// themselves stay in the plugin's schema; this is only what the settings screen needs to
// place the section and say who added it.
export type PluginSettingsSection = Omit<SectionSpec, "fields" | "actions"> & { plugin: string; homes: string[] };
export type AppAccountSummary = { provider: string; label: string; enabled: boolean; quotaPct: number | null };
export type AppProviderAgg = { provider: string; accounts: number; enabled: number };
export type AppSummary = {
  accounts: AppAccountSummary[];
  providerCount: number;
  accountsEnabled: number;
  providerBreakdown: AppProviderAgg[];
  quotaMinPct: number | null;
  configDir: string;
  pluginCount: number;
  routingSlots: number | null;
};
export type CustomEndpoint = { id: string; label: string; baseUrl: string; format: string; models: string[] };
export type CustomEndpointView = CustomEndpoint & { hasKey: boolean };

export type ConfigSnapshot = { hash: string; date: string; subject: string };
export type ConfigDiffRow = { file: string; key: string; old: string; new: string };
export type ConfigProfilesView = { list: string[]; current: string };
export type ConfigHomeView = {
  homeId: PluginHomeId;
  label: string;
  icon?: string;
  present: boolean;
  snapshots: ConfigSnapshot[];
  pending: ConfigDiffRow[];
  profiles: ConfigProfilesView;
};
export type ProfileSwitchResult = { ok: boolean; reason?: string };
export type BusEvent = { topic: string; source: string; ts: number; payload: unknown };
export type LoginBegin = { url: string; instructions: string; loopback?: boolean };
export type LoginComplete = { added: boolean; label?: string };
