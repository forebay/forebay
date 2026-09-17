import type { ForebayAPI } from "./api.js";

// Method name (on ForebayAPI) to IPC channel string. This is the single source for
// the request/response surface: the preload builds its bridge from this map, and
// the main-process allow-list + router derive their channel list from it. Add a
// channel here (plus its ForebayAPI signature and sidecar handler) and every layer
// picks it up.
export const INVOKE_CHANNELS = {
  getConfig: "config:get",
  setConfig: "config:set",
  overviewSummary: "overview:summary",
  accountsList: "accounts:list",
  accountsEnable: "accounts:enable",
  accountsRemove: "accounts:remove",
  accountsRefreshQuota: "accounts:refreshQuota",
  accountsLoginBegin: "accounts:loginBegin",
  accountsLoginComplete: "accounts:loginComplete",
  accountsLoginCancel: "accounts:loginCancel",
  providersList: "providers:list",
  providersSetEnabled: "providers:setEnabled",
  providersSetExposure: "providers:setExposure",
  routingApps: "routing:apps",
  routingGet: "routing:get",
  routingSetChain: "routing:setChain",
  proxyStatus: "proxy:status",
  proxyStart: "proxy:start",
  proxyStop: "proxy:stop",
  proxiesList: "proxies:list",
  proxiesSetEnabled: "proxies:setEnabled",
  appsDetect: "apps:detect",
  appsList: "apps:list",
  appsInstallCli: "apps:installCli",
  appsUninstallCli: "apps:uninstallCli",
  appsSummary: "apps:summary",
  appsConnection: "apps:connection",
  appsInstallLoader: "apps:installLoader",
  appStorageGet: "apps:storageGet",
  appStorageSet: "apps:storageSet",
  repoMeta: "repo:meta",
  repoMetaCached: "repo:metaCached",
  pluginVersions: "plugins:versions",
  pluginVersionsAll: "plugins:versionsAll",
  pluginVersionsCached: "plugins:versionsCached",
  pluginsList: "plugins:list",
  pluginsListCached: "plugins:listCached",
  librariesList: "libraries:list",
  librariesRemove: "libraries:remove",
  enginesList: "engines:list",
  enginesEnsure: "engines:ensure",
  jobsList: "jobs:list",
  jobsEnqueue: "jobs:enqueue",
  jobsCancel: "jobs:cancel",
  jobsClearFinished: "jobs:clearFinished",
  pluginsInstall: "plugins:install",
  pluginsRemoveEverywhere: "plugins:removeEverywhere",
  pluginsSetEnabled: "plugins:setEnabled",
  pluginsSetAutoUpdate: "plugins:setAutoUpdate",
  pluginsSetChannel: "plugins:setChannel",
  pluginsDowngrade: "plugins:downgrade",
  pluginsUninstall: "plugins:uninstall",
  pluginsData: "plugins:data",
  pluginsRemoveData: "plugins:removeData",
  configSchemas: "config:schemas",
  settingsSections: "settings:sections",
  configWrite: "config:write",
  configAction: "config:action",
  screensList: "screens:list",
  screenData: "screens:data",
  screenInvoke: "screens:invoke",
  busDrain: "bus:drain",
  activityRead: "activity:read",
  activityStats: "activity:stats",
  updatesCheck: "updates:check",
  updatesOne: "updates:one",
  updatesAll: "updates:all",
  globalSettingsRead: "settings:read",
  usageSnapshot: "usage:snapshot",
  importApps: "import:apps",
  importPreview: "import:preview",
  importRun: "import:run",
  catalogList: "catalog:list",
  catalogListCached: "catalog:listCached",
  githubStatus: "github:status",
  githubAddAccount: "github:add-account",
  githubSwitchAccount: "github:switch-account",
  githubRemoveAccount: "github:remove-account",
  githubConnectGhCli: "github:connect-gh",
  githubSetStar: "github:set-star",
  githubStarForebay: "github:star-forebay",
  githubDeviceStart: "github:device-start",
  githubDevicePoll: "github:device-poll",
  favoritesList: "favorites:list",
  favoritesToggle: "favorites:toggle",
  marketplaceSourcesList: "marketplaceSources:list",
  marketplaceSourcesSave: "marketplaceSources:save",
  customEndpointsList: "customEndpoints:list",
  customEndpointsFormats: "customEndpoints:formats",
  customEndpointsUpsert: "customEndpoints:upsert",
  customEndpointsRemove: "customEndpoints:remove",
  customEndpointsSaveKey: "customEndpoints:saveKey",
  pluginLedger: "plugins:ledger",
  pluginQuarantine: "plugins:quarantine",
} as const;

export type InvokeMethod = keyof typeof INVOKE_CHANNELS;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[InvokeMethod];

export const IPC_CHANNELS = {
  invoke: Object.values(INVOKE_CHANNELS) as readonly InvokeChannel[],
  send: ["window:minimize", "window:maximize", "window:close"] as const,
  receive: ["server:status", "downloads:progress", "activity:event", "jobs:event"] as const,
};

// The methods on ForebayAPI that are NOT request/response invocations (window
// controls, the push subscriptions, and the static flags).
type NonInvokeMethod = "minimize" | "maximize" | "close" | "onServerStatus" | "onDownloadProgress" | "onActivityEvent" | "onJobEvent" | "isElectron" | "platform";
type ApiInvokeMethod = Exclude<keyof ForebayAPI, NonInvokeMethod>;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Compile-time guard: INVOKE_CHANNELS maps exactly ForebayAPI's invoke methods, no
// more and no less. A drift on either side turns this into `never` and fails the build.
const _invokeChannelsMatchApi: Exact<InvokeMethod, ApiInvokeMethod> = true;
void _invokeChannelsMatchApi;

// A channel whose action only READS state. The dashboard polls several of these on a
// timer, so attributing them to a user action would make routine polling look like
// something a person did. Anything not listed here is treated as a change.
const READ_ONLY_ACTIONS: readonly string[] = [
  "apps", "check", "connection", "data", "detect", "drain", "device-poll", "formats", "get",
  "ledger", "list", "listCached", "meta", "metaCached", "preview", "quarantine", "read", "schemas",
  "sections", "snapshot", "stats", "status", "storageGet", "summary", "versions", "versionsAll", "versionsCached",
];

export function isReadOnlyChannel(channel: string): boolean {
  const at = String(channel).indexOf(":");
  return at >= 0 && READ_ONLY_ACTIONS.includes(channel.slice(at + 1));
}

