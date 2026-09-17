import type { Result } from "../../packages/shared/src/domain.js";
import { isReadOnlyChannel } from "../../packages/shared/src/ipc.js";
import { initCoreProxy } from "@intisy-ai/basekit/proxy";
import type { UpdateTrigger } from "@intisy-ai/basekit";
import { ok, err } from "./result.js";
import { configGet, configSet } from "./modules/config.js";
import { overviewSummary } from "./modules/overview.js";
import { accountsList, accountsEnable, accountsRemove, accountsRefreshQuota } from "./modules/accounts.js";
import { accountsLoginBegin, accountsLoginComplete, accountsLoginCancel } from "./modules/accountsLogin.js";
import { providersList, providersSetEnabled, providersSetExposure } from "./modules/providers.js";
import { routingApps, routingGet, routingSetChain } from "./modules/routing.js";
import { appsDetect, appsList, appsInstallCli, appsUninstallCli, appsSummary, appsConnection, appsInstallLoader } from "./modules/apps.js";
import { pluginsList, pluginsListCached, pluginVersions, pluginVersionsAll, pluginVersionsCached, pluginsInstall, pluginsRemoveEverywhere, pluginsSetEnabled, pluginsSetAutoUpdate, pluginsSetChannel, pluginsDowngrade, pluginsUninstall } from "./modules/plugins.js";
import { enginesList, ensureEngine } from "./modules/engines.js";
import { proxiesList, proxiesSetEnabled } from "./modules/proxies.js";
import { repoMeta, repoMetaCached } from "./modules/repo.js";
import { configSchemas, configWrite, configAction } from "./modules/appConfig.js";
import { screensList, settingsSections } from "./modules/contributions.js";
import { screenData, screenInvoke } from "./modules/screens.js";
import { pluginLedger, pluginQuarantine } from "./modules/diagnostics.js";
import { busDrain } from "./modules/bus.js";
import { pluginsData, pluginsRemoveData } from "./modules/pluginData.js";
import { jobsList, jobsEnqueue, jobsCancel, jobsClearFinished, setJobListener } from "./modules/jobs.js";
import type { JobKind } from "./jobs/model.js";
import { activityRead, activityStatsRead } from "./modules/activity.js";
import { globalSettingsRead } from "./modules/globalSettings.js";
import { updatesCheck, updatesOne, updatesAll } from "./modules/updates.js";
import { librariesList, librariesRemove } from "./modules/libraries.js";
import { appStorageGet, appStorageSet } from "./modules/appPaths.js";
import { invokePluginManagement } from "./lib/pluginManager.js";
import { stopAllHosts } from "./lib/pluginHost.js";
import { migrateLegacySettings } from "../main/lib/legacySettings.js";
import type { PluginHomeId } from "../../packages/shared/src/domain.js";
import type { ActivityQuery } from "@intisy-ai/basekit";
import { setActivityContext, withCause } from "@intisy-ai/basekit";
import { forebayHome } from "./lib/pluginHomes.js";
import { usageSnapshot } from "./modules/usage.js";
import { discoverApps } from "./lib/appDiscovery.js";
import { importApps, importPreview, importRun } from "./modules/import.js";
import type { ImportSelection } from "../../packages/shared/src/domain.js";
import { catalogList, catalogListCached } from "./modules/catalog.js";
import { githubStatus, githubAddAccount, githubSwitchAccount, githubRemoveAccount, githubConnectGhCli, githubSetStar, githubStarForebay, githubDeviceStart, githubDevicePoll } from "./modules/github.js";
import { customEndpointsList, customEndpointsUpsert, customEndpointsRemove, customEndpointsSaveKey, customEndpointsFormats } from "./modules/customEndpoints.js";
import { marketplaceSourcesList, marketplaceSourcesSave } from "./modules/marketplaceSources.js";
import type { CustomEndpoint } from "../../packages/shared/src/domain.js";
import { favoritesList, favoritesToggle } from "./modules/favorites.js";

type SidecarRequest = { id: number; channel: string; args: unknown[] };
type SidecarResponse = { id: number; result: Result<unknown> };

type SidecarHandler = (...args: unknown[]) => Promise<Result<unknown>>;

const handlers: Record<string, SidecarHandler> = {};

// The home an event is written to has to be the same home the Activity view reads,
// so this states the one value pluginHomes already calls this app's own dir. Deriving
// it a second way is how they drift apart.
// Before the first settings read, and again here rather than only in main, because the sidecar
// also runs on its own under the e2e harness and the CLI.
migrateLegacySettings(forebayHome());

try {
  setActivityContext({ app: "forebay", entry: "sidecar", home: forebayHome() });
} catch { /* attribution is never worth failing to start over */ }

export function registerHandler(channel: string, handler: SidecarHandler): void {
  handlers[channel] = handler;
}

export interface BackgroundUpdateDeps {
  home?: string;
  runUpdates?: (dir: string, trigger: UpdateTrigger) => Promise<unknown>;
}

// The trigger, not a bare "update everything": the home's own policy decides whether a dashboard
// launch is an occasion it wants updates on, and only the manager holding that policy can say.
const LAUNCH_TRIGGER: UpdateTrigger = "dashboard";

// Fire and forget on purpose: the dashboard must open whether or not an update run
// works, and must not wait on ls-remote before answering its first request.
export function startBackgroundUpdates(deps: BackgroundUpdateDeps = {}): void {
  const home = deps.home ?? forebayHome();
  void (async () => {
    try {
      const run = deps.runUpdates ?? ((dir: string, trigger: UpdateTrigger) =>
        invokePluginManagement(dir, LAUNCH_TRIGGER, "runUpdates", null, (capability) =>
          capability.runUpdates(trigger as UpdateTrigger)));
      await run(home, LAUNCH_TRIGGER);
    } catch { /* an update run is never worth a dashboard that will not start */ }
  })();
}

// A download-task id (passed as the trailing install arg) turns into a reporter
// that streams phase steps back to the renderer as out-of-band progress messages.
// Every job transition is pushed, so the renderer mirrors the queue instead of owning one.
setJobListener((job) => {
  try {
    process.parentPort.postMessage({ job });
  } catch { /* a dropped update must never fail the job it describes */ }
});

process.on("beforeExit", () => { void stopAllHosts(); });

// A value the message channel cannot clone (a promise, a function, a live handle) throws
// on postMessage, and an unhandled throw here takes the whole sidecar down with every
// pending request. Answering with the clone error instead keeps one bad payload local to
// the call that produced it.
function reply(response: SidecarResponse): void {
  try {
    process.parentPort.postMessage(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      process.parentPort.postMessage({ id: response.id, result: err(`result could not be sent: ${message}`) });
    } catch { /* nothing left to try; the supervisor's timeout answers the caller */ }
  }
}

function reportFor(progressId: unknown): ((step: string, percent: number) => void) | undefined {
  if (typeof progressId !== "number" || !process.parentPort) return undefined;
  return (step, percent) => process.parentPort.postMessage({ progress: { id: progressId, step, percent } });
}

export async function dispatch(channel: string, args: unknown[]): Promise<Result<unknown>> {
  const handler = handlers[channel];
  if (!handler) return err(`no handler registered for channel: ${channel}`);
  try {
    // One scope over every registered channel, so no handler needs its own attribution.
    // A read is the dashboard watching state (often on a timer); everything else is a
    // change someone asked for.
    const kind = isReadOnlyChannel(channel) ? "watch" : "user";
    return await withCause({ kind, surface: channel }, () => handler(...args));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

registerHandler("config:get", (name, key) => configGet(name as string, key as string));
registerHandler("config:set", (name, key, value) => configSet(name as string, key as string, value));
registerHandler("overview:summary", () => overviewSummary());
registerHandler("accounts:list", (provider) => accountsList(provider as string));
registerHandler("accounts:enable", (provider, id, on) => accountsEnable(provider as string, id as string, on as boolean));
registerHandler("accounts:remove", (provider, id) => accountsRemove(provider as string, id as string));
registerHandler("accounts:refreshQuota", (provider) => accountsRefreshQuota(provider as string));
registerHandler("accounts:loginBegin", (provider) => accountsLoginBegin(provider as string));
registerHandler("accounts:loginComplete", (provider, input) => accountsLoginComplete(provider as string, input as string));
registerHandler("accounts:loginCancel", (provider) => accountsLoginCancel(provider as string));
registerHandler("providers:list", () => providersList());
registerHandler("providers:setEnabled", (id, on) => providersSetEnabled(id as string, on as boolean));
registerHandler("providers:setExposure", (id, app, on) => providersSetExposure(id as string, app as string, on as boolean));
registerHandler("routing:apps", () => routingApps());
registerHandler("routing:get", (app) => routingGet(app as string));
registerHandler("routing:setChain", (app, slot, chain) => routingSetChain(app as string, slot as string, chain));
registerHandler("apps:detect", () => appsDetect());
registerHandler("apps:list", () => appsList());
registerHandler("apps:installCli", (app) => appsInstallCli(app as string));
registerHandler("apps:uninstallCli", (app, wipeData) => appsUninstallCli(app as string, wipeData as boolean));
registerHandler("apps:summary", (app) => appsSummary(app as string));
registerHandler("apps:connection", (app) => appsConnection(app as string));
registerHandler("apps:installLoader", (app) => appsInstallLoader(app as string));
registerHandler("apps:storageGet", (app) => appStorageGet(app as string));
registerHandler("apps:storageSet", (app, names) => appStorageSet(app as string, names as never));
registerHandler("repo:meta", (url) => repoMeta(url as string));
registerHandler("repo:metaCached", (url) => repoMetaCached(url as string));
registerHandler("plugins:list", () => pluginsList());
registerHandler("plugins:listCached", () => pluginsListCached());
registerHandler("libraries:list", () => librariesList());
registerHandler("libraries:remove", (home, specifier) => librariesRemove(home as string, specifier as string));
registerHandler("plugins:versions", (name) => pluginVersions(name as string));
registerHandler("plugins:versionsAll", () => pluginVersionsAll());
registerHandler("plugins:versionsCached", () => pluginVersionsCached());
registerHandler("engines:list", () => enginesList());
registerHandler("engines:ensure", (capability) => ensureEngine(capability as string));
registerHandler("jobs:list", () => jobsList());
registerHandler("jobs:enqueue", (kind, plugin, url, home) => jobsEnqueue(kind as JobKind, plugin as string, url as string, home as string));
registerHandler("jobs:cancel", (id) => jobsCancel(id as string));
registerHandler("jobs:clearFinished", () => jobsClearFinished());
registerHandler("plugins:install", (home, name, url, progressId) => pluginsInstall(home as PluginHomeId, name as string, url as string, { report: reportFor(progressId) }));
registerHandler("plugins:removeEverywhere", (name) => pluginsRemoveEverywhere(name as string));
registerHandler("plugins:setEnabled", (home, name, on) => pluginsSetEnabled(home as PluginHomeId, name as string, on as boolean));
registerHandler("plugins:setAutoUpdate", (home, name, on) => pluginsSetAutoUpdate(home as PluginHomeId, name as string, on as boolean));
registerHandler("plugins:setChannel", (home, name, channel) => pluginsSetChannel(home as PluginHomeId, name as string, channel as "inherit" | "stable" | "experimental"));
registerHandler("plugins:downgrade", (home, name, hash) => pluginsDowngrade(home as PluginHomeId, name as string, hash as string));
registerHandler("plugins:uninstall", (home, name) => pluginsUninstall(home as string, name as string));
registerHandler("plugins:data", (name) => pluginsData(name as string));
registerHandler("plugins:removeData", (home, paths) => pluginsRemoveData(home as string, paths as string[]));
registerHandler("proxies:list", () => proxiesList());
registerHandler("proxies:setEnabled", (name, on) => proxiesSetEnabled(name as string, on as boolean));
registerHandler("config:schemas", (home) => configSchemas(home as string));
registerHandler("screens:list", (opts) => screensList((opts ?? {}) as { wait?: boolean }));
registerHandler("settings:sections", (opts) => settingsSections((opts ?? {}) as { wait?: boolean }));
registerHandler("config:write", (home, plugin, key, value) => configWrite(home as string, plugin as string, key as string, value));
registerHandler("config:action", (home, plugin, actionId, input) => configAction(home as string, plugin as string, actionId as string, input as Record<string, unknown> | undefined));
registerHandler("screens:data", (plugin, screen, home) => screenData(plugin as string, screen as string, home as string));
registerHandler("screens:invoke", (plugin, screenId, action, home, args) => screenInvoke(plugin as string, screenId as string, action as string, home as string, args as Record<string, unknown>));
registerHandler("plugins:ledger", () => pluginLedger());
registerHandler("plugins:quarantine", () => pluginQuarantine());
registerHandler("bus:drain", () => busDrain());
registerHandler("updates:check", (homeId) => updatesCheck(homeId as string));
registerHandler("updates:one", (homeId, name) => updatesOne(homeId as string, name as string));
registerHandler("updates:all", (homeId) => updatesAll(homeId as string));
registerHandler("activity:read", (query) => activityRead(query as ActivityQuery));
registerHandler("activity:stats", () => activityStatsRead());
registerHandler("settings:read", () => globalSettingsRead());
registerHandler("usage:snapshot", () => usageSnapshot());
registerHandler("import:apps", () => importApps());
registerHandler("import:preview", (app) => importPreview(app as string));
registerHandler("import:run", (app, selection) => importRun(app as string, selection as ImportSelection | undefined));
registerHandler("catalog:list", () => catalogList());
registerHandler("catalog:listCached", () => catalogListCached());
registerHandler("github:status", () => githubStatus());
registerHandler("github:add-account", (token, star) => githubAddAccount(token as string, star as boolean));
registerHandler("github:switch-account", (login) => githubSwitchAccount(login as string));
registerHandler("github:remove-account", (login) => githubRemoveAccount(login as string));
registerHandler("github:connect-gh", (star) => githubConnectGhCli(star as boolean));
registerHandler("github:set-star", (url, starred) => githubSetStar(url as string, starred as boolean));
registerHandler("github:star-forebay", () => githubStarForebay());
registerHandler("github:device-start", () => githubDeviceStart());
registerHandler("github:device-poll", (star) => githubDevicePoll(star as boolean));
registerHandler("favorites:list", () => favoritesList());
registerHandler("favorites:toggle", (name) => favoritesToggle(name as string));
registerHandler("marketplaceSources:list", () => marketplaceSourcesList());
registerHandler("marketplaceSources:save", (sources) => marketplaceSourcesSave(sources));
registerHandler("customEndpoints:list", () => customEndpointsList());
registerHandler("customEndpoints:formats", () => customEndpointsFormats());
registerHandler("customEndpoints:upsert", (endpoint) => customEndpointsUpsert(endpoint as CustomEndpoint));
registerHandler("customEndpoints:remove", (id) => customEndpointsRemove(id as string));
registerHandler("customEndpoints:saveKey", (endpointId, key) => customEndpointsSaveKey(endpointId as string, key as string));
// A killed child never fires beforeExit, so the supervisor calls this channel before kill(),
// letting a plugin's deactivate still run on a normal quit.
registerHandler("shutdown", async () => { await stopAllHosts(); return ok(true); });

if (process.parentPort) {
  // core-proxy eager-loads its TeaVM routing module; the routing/apps/import modules
  // call its sync decision functions (resolveModelMap, profileTiers), so init before
  // handling any message.
  await initCoreProxy();
  process.parentPort.on("message", (messageEvent) => {
    const { id, channel, args } = messageEvent.data as SidecarRequest;
    dispatch(channel, args).then((result) => {
      reply({ id, result });
    }, (thrown: unknown) => {
      reply({ id, result: err(thrown instanceof Error ? thrown.message : String(thrown)) });
    });
  });
  // Prewarm the transcript cache so the first Usage view doesn't sit on a
  // multi-second cold scan of the full session history.
  void usageSnapshot();
  // Populate the app registry on boot so it's ready before the first apps:list call.
  void discoverApps();
  // Refresh update state for this home in the background. Its own trigger setting
  // decides whether anything happens, so there is no separate dashboard switch.
  startBackgroundUpdates();
}


