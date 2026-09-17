import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { join } from "node:path";
import { getConfigDir } from "@intisy-ai/basekit/auth";
import { getConfigValue, activityEnv, getAppDescriptor, registerPluginWithApp } from "@intisy-ai/basekit";
import type { ActionResult, ManagedNpmPlugin, ManagedPlugin, PluginManagementCapability, PluginUpdateCache } from "@intisy-ai/basekit";
import { readPluginManifest } from "../lib/pluginManifest.js";
import { pluginIdFromClone } from "../lib/capabilityOwner.js";
import { emitForebayAction } from "../activity.js";
import type { HomePlugins, PluginHome, PluginHomeId, PluginRow, PluginVersion, UpdateState, Result, InstallManyResult, InstallOutcome } from "../../../packages/shared/src/domain.js";
import { pluginHomes, homeDir, homeById, managerInstalled } from "../lib/pluginHomes.js";
import { readNamespace, writeCacheMany } from "../lib/cache.js";
import { installPluginRepo } from "../lib/pluginBootstrap.js";
import { repoProvidingCapability } from "../lib/capabilityCatalog.js";
import { pluginOwningCapability } from "./engines.js";
import { pruneUnusedLibraries } from "./libraryPrune.js";
import { invokeCrossAppSync, invokePluginManagement, listedPlugins, readPluginManagement } from "../lib/pluginManager.js";
import { wrap } from "../result.js";
import { reposDir } from "../lib/storagePaths.js";

const VERSIONS_NS = "versions";
const PLUGINS_NS = "plugins";
const PLUGIN_MANAGEMENT = "plugin-management";

// The catalog answers first (what a home's marketplace sources DECLARE), which is what
// recognizes the manager during its own from-scratch bootstrap, before anything is
// deployed anywhere. The deployed-manifest lookup is the fallback: it is what still
// recognizes an already-deployed manager when the catalog cannot be reached. A catalog
// failure degrades to that fallback, and then to false; it never aborts the check.
async function isPluginManager(name: string, homeDir: string): Promise<boolean> {
  let catalogId: string | null = null;
  try {
    catalogId = (await repoProvidingCapability(homeDir, PLUGIN_MANAGEMENT))?.id ?? null;
  } catch {
    catalogId = null;
  }
  return catalogId === name || pluginOwningCapability(PLUGIN_MANAGEMENT, homeDir) === name;
}

type PluginChannel = "inherit" | "stable" | "experimental";
type InstallPluginFn = (dir: string, name: string, url: string, appId: string, report?: (step: string, percent: number) => void) => Promise<void>;
type SyncPluginsAcrossAppsFn = (configDir: string, appId: string) => Promise<void>;
type DowngradeFn = (name: string, commitHash: string, appId: string) => Promise<ActionResult | null>;
type HasUpdaterFn = (dir: string, appId: string) => boolean | Promise<boolean>;
type RegisterWithAppFn = (dir: string, app: string, plugin: string) => void | Promise<void>;

const EMPTY_UPDATE_CACHE: PluginUpdateCache = { checkedAt: new Date(0).toISOString(), plugins: {} };

async function realRegisterPlugin(dir: string, name: string, url: string, appId: string): Promise<void> {
  const registered = await invokePluginManagement(dir, appId, "register", null, (capability) => capability.register(url));
  if (!registered) throw new Error(`nothing manages the plugins of ${appId}`);
}

// null means no manager answered at all, distinct from a refusal (a manager answered and said the
// plugin is not there), so callers report the real cause instead of a misleading "not found".
async function wrote(
  dir: string,
  appId: string,
  operation: string,
  work: (capability: PluginManagementCapability) => Promise<ActionResult>,
): Promise<boolean | null> {
  const answer = await invokePluginManagement(dir, appId, operation, null, work);
  return answer === null ? null : answer.ok;
}

function realSetPluginEnabled(dir: string, name: string, on: boolean, appId: string): Promise<boolean | null> {
  return wrote(dir, appId, "setEnabled", (capability) => capability.setEnabled(name, on));
}

function realSetPluginAutoUpdate(dir: string, name: string, on: boolean, appId: string): Promise<boolean | null> {
  return wrote(dir, appId, "setAutoUpdate", (capability) => capability.setAutoUpdate(name, on));
}

function realSetPluginChannel(dir: string, name: string, channel: PluginChannel, appId: string): Promise<boolean | null> {
  return wrote(dir, appId, "setChannel", (capability) => capability.setChannel(name, channel));
}

function realReadUpdateCache(dir: string, appId: string): Promise<PluginUpdateCache> {
  return readPluginManagement(dir, appId, "updateCache", EMPTY_UPDATE_CACHE, (capability) => capability.updateCache());
}

// The single question both the dashboard and the loader TUI ask; a home with no manager has no
// channel to report, which reads the same as "never opted in".
function realChannelState(dir: string, name: string, appId: string): Promise<{ onExperimental: boolean; experimentalAvailable: boolean | null }> {
  return readPluginManagement(dir, appId, "channelState", { onExperimental: false, experimentalAvailable: null },
    (capability) => capability.channelState(name));
}

// Reconciling across homes belongs to whichever plugin provides it, so this asks the home rather
// than loading one. A home with no provider reconciles nothing, which is what installing into a
// home that never had cross-app sync already did.
async function realSyncPluginsAcrossApps(dir: string, appId: string): Promise<void> {
  await invokeCrossAppSync(dir, appId, null, (capability) => capability.sync());
}

// The app declares how it auto-loads a plugin, so this asks the registry rather than a plugin.
// An app that declares no mechanism auto-loads nothing, which is not an install failure.
function realRegisterWithApp(dir: string, app: string, plugin: string): void {
  registerPluginWithApp(dir, getAppDescriptor(app) ?? null, plugin);
}

function getNpmPlugins(configDir: string, appId: string): Promise<ManagedNpmPlugin[]> {
  return readPluginManagement(configDir, appId, "listNpm", [], (capability) => capability.listNpm());
}

// A separately-bundled plugin has its own async-context store and cannot see the cause scope this
// dispatch is running in. The environment is the one channel both bundles share: exporting the
// cause and the app id here lets its records say who asked and which app they belong to instead of
// "unknown" and "no app". Safe to touch process-wide only because this chain serializes the calls.
let writeChain: Promise<unknown> = Promise.resolve();

const ACTIVITY_ENV_KEYS = ["HUB_ACTIVITY_TRACE", "HUB_ACTIVITY_CAUSE", "HUB_ACTIVITY_PARENT", "CORE_APP"];

export function withAttribution<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ACTIVITY_ENV_KEYS) saved[key] = process.env[key];
    try {
      Object.assign(process.env, activityEnv());
      process.env.CORE_APP = appId;
    } catch { /* attribution is never worth failing the operation */ }
    try {
      return await fn();
    } finally {
      for (const key of ACTIVITY_ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
  writeChain = run.catch(() => undefined);
  return run;
}

function readDescription(homeDirPath: string, name: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(reposDir(homeDirPath), name, "package.json"), "utf-8"));
    return typeof pkg.description === "string" ? pkg.description : "";
  } catch {
    return "";
  }
}

function rowFor(name: string, kind: "git" | "npm", enabled: boolean, url: string | undefined, cache: PluginUpdateCache, homeDirPath: string): PluginRow {
  const entry = cache.plugins[name];
  const manifest = readPluginManifest(name, homeDirPath);
  return {
    name,
    // Only a git clone has its own plugin.json to declare one; an npm plugin has no clone.
    pluginId: kind === "git" ? pluginIdFromClone(name, homeDirPath) : undefined,
    kind,
    // An npm plugin is present by virtue of being listed; a git one needs its clone. A config
    // entry with nothing behind it is an install the manager has not carried out yet.
    present: kind === "npm" || existsSync(join(reposDir(homeDirPath), name)),
    enabled,
    url,
    installedVersion: entry?.installedVersion ?? null,
    updateAvailable: entry?.updateAvailable ?? false,
    description: readDescription(homeDirPath, name),
    displayName: manifest.displayName,
    icon: manifest.icon,
  };
}

export interface PluginsDeps {
  homes?: PluginHome[];
  cacheDir?: string;
  missingArtifacts?: (dir: string, name: string, appId: string) => Promise<string[]>;
  installPlugin?: InstallPluginFn;
  syncPluginsAcrossApps?: SyncPluginsAcrossAppsFn;
  downgrade?: DowngradeFn;
  npmPlugins?: (dir: string, appId: string) => Promise<ManagedNpmPlugin[]>;
  uninstallPlugin?: (name: string, appId: string) => Promise<ActionResult | null>;
  uninstallNpmPlugin?: (name: string, appId: string) => Promise<ActionResult | null>;
  managesPlugins?: HasUpdaterFn;
  registerWithApp?: RegisterWithAppFn;
  ensureUpdater?: (homeId: string) => Promise<Result<void>>;
  // Symmetric with setPluginChannel: the write itself belongs to the home's manager, so these are
  // the seam a test observes the delegation through rather than by reading a file this no longer
  // writes.
  readCache?: (dir: string, appId: string) => PluginUpdateCache | Promise<PluginUpdateCache>;
  registerPlugin?: (dir: string, name: string, url: string, appId: string) => Promise<void>;
  setPluginEnabled?: (dir: string, name: string, on: boolean, appId: string) => boolean | null | Promise<boolean | null>;
  setPluginAutoUpdate?: (dir: string, name: string, on: boolean, appId: string) => boolean | null | Promise<boolean | null>;
  setPluginChannel?: (dir: string, name: string, channel: PluginChannel, appId: string) => boolean | null | Promise<boolean | null>;
  getPlugins?: (dir: string, appId: string) => ManagedPlugin[] | Promise<ManagedPlugin[]>;
  // Called at each phase boundary so a download row can show live progress;
  // percent is coarse phase-based progress 0..100.
  report?: (step: string, percent: number) => void;
  prune?: (dir: string, appId: string) => Promise<string[]>;
}

async function resolveHomes(deps: PluginsDeps): Promise<PluginHome[]> {
  return deps.homes ?? (await pluginHomes());
}

export function pluginsList(deps: PluginsDeps = {}): Promise<Result<HomePlugins[]>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const listGit = deps.getPlugins ?? listedPlugins;
    const missingArtifacts = deps.missingArtifacts ?? ((dir: string, name: string, appId: string) =>
      readPluginManagement(dir, appId, "missingArtifacts", [] as string[], (capability) => capability.missingArtifacts(name)));
    // Homes are independent, so they are read concurrently rather than one after
    // another: the list is what the user waits on before any plugin screen paints.
    const sections = await Promise.all(homes.map(async (home): Promise<HomePlugins> => {
      if (!home.present) return { home, rows: [] };
      const cache = await (deps.readCache ?? realReadUpdateCache)(home.dir, home.id);
      const gitRows = await Promise.all((await listGit(home.dir, home.id)).map(async (p) => ({
        ...rowFor(p.id, "git", p.enabled, p.url, cache, home.dir),
        // Only a git clone has a build to be incomplete; an npm install either resolved or did not.
        missingArtifacts: await missingArtifacts(home.dir, p.id, home.id),
      })));
      const npmRows = (await (deps.npmPlugins ?? getNpmPlugins)(home.dir, home.id)).map((p) => rowFor(p.name, "npm", true, undefined, cache, home.dir));
      return { home, rows: [...gitRows, ...npmRows] };
    }));
    writeCacheMany(PLUGINS_NS, Object.fromEntries(sections.map((s) => [s.home.id, s])), deps.cacheDir ?? getConfigDir());
    return sections;
  });
}

// The last list this home produced, returned without touching disk beyond the cache file.
// The screen paints from this first so it is never blank while the real read runs, which is
// what the wait before any plugin screen appeared actually was.
export function pluginsListCached(deps: PluginsDeps = {}): Promise<Result<HomePlugins[]>> {
  return wrap(async () => {
    const ns = readNamespace<HomePlugins>(PLUGINS_NS, deps.cacheDir ?? getConfigDir());
    return Object.values(ns).map((entry) => entry.value);
  });
}

// Async so a git subprocess never blocks the single-threaded sidecar event loop;
// blocking here previously stalled every other request (readmes, the plugin list)
// while the whole plugin set was described.
async function realDescribe(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "describe", "--tags", "--always"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// A full clone carries every release tag, so `git describe` yields the last tag
// plus how far ahead HEAD is: "v1.2.3" on a tag, "v1.2.3 +5" five commits later,
// and a bare short SHA when the repo has no tags at all.
export function formatGitVersion(describe: string | null): string | null {
  if (!describe) return null;
  const ahead = describe.match(/^(.*)-(\d+)-g[0-9a-f]+$/);
  return ahead ? `${ahead[1]} +${ahead[2]}` : describe;
}

export interface PluginVersionsDeps {
  homes?: PluginHome[];
  readCache?: (dir: string) => PluginUpdateCache | Promise<PluginUpdateCache>;
  describe?: (dir: string) => string | null | Promise<string | null>;
  exists?: (path: string) => boolean;
  getPlugins?: (dir: string, appId: string) => ManagedPlugin[] | Promise<ManagedPlugin[]>;
  npmPlugins?: (dir: string, appId: string) => Promise<ManagedNpmPlugin[]>;
  channelState?: (dir: string, name: string, appId: string) => { onExperimental: boolean; experimentalAvailable: boolean | null } | Promise<{ onExperimental: boolean; experimentalAvailable: boolean | null }>;
  // Where the persistent version cache lives; "" disables it (used in tests).
  cacheDir?: string;
}

// The last-known versions from the persistent cache, so the Plugins list shows
// versions instantly on load while pluginVersionsAll() recomputes in the
// background. Returns an empty map on a cold cache.
export function pluginVersionsCached(deps: PluginVersionsDeps = {}): Promise<Result<Record<string, Record<string, PluginVersion>>>> {
  return wrap(async () => {
    const ns = readNamespace<Record<string, PluginVersion>>(VERSIONS_NS, deps.cacheDir ?? getConfigDir());
    const out: Record<string, Record<string, PluginVersion>> = {};
    for (const [name, entry] of Object.entries(ns)) out[name] = entry.value;
    return out;
  });
}

// An entry with no local head was never successfully read, so its remote comparison says
// nothing: report that rather than letting a missing side pass for "up to date".
export function gitUpdateState(entry: PluginUpdateCache["plugins"][string] | undefined): UpdateState {
  if (!entry) return "unknown";
  if (entry.updateAvailable) return "behind";
  return entry.localHead ? "current" : "unknown";
}

async function gitVersionFor(
  repoDir: string,
  entry: PluginUpdateCache["plugins"][string] | undefined,
  describe: (dir: string) => string | null | Promise<string | null>,
  autoUpdate: boolean,
  checkedAt: string | null,
  channel: { onExperimental: boolean; experimentalAvailable: boolean | null },
  declaredChannel: PluginChannel | undefined,
): Promise<PluginVersion> {
  const label = formatGitVersion(await describe(repoDir)) ?? (entry?.localHead ? entry.localHead.slice(0, 7) : null);
  return {
    kind: "git",
    label,
    updateState: gitUpdateState(entry),
    autoUpdate,
    checkedAt,
    onExperimental: channel.onExperimental,
    experimentalAvailable: channel.experimentalAvailable,
    channel: declaredChannel,
  };
}

// A registered-but-uncloned plugin has no real version (label null), but its channel answer needs no clone, so it is still asked for here.
async function markUnknown(
  perHome: Record<string, PluginVersion>,
  name: string,
  homes: { id: string; appId: string; dir: string; autoUpdate: boolean; channel?: PluginChannel }[],
  channelState: (dir: string, name: string, appId: string) => { onExperimental: boolean; experimentalAvailable: boolean | null } | Promise<{ onExperimental: boolean; experimentalAvailable: boolean | null }>,
): Promise<void> {
  for (const h of homes) {
    const channel = await channelState(h.dir, name, h.appId);
    perHome[h.id] = {
      kind: "git",
      label: null,
      updateState: "unknown",
      autoUpdate: h.autoUpdate,
      onExperimental: channel.onExperimental,
      experimentalAvailable: channel.experimentalAvailable,
      channel: h.channel,
    };
  }
}

export function pluginVersions(name: string, deps: PluginVersionsDeps = {}): Promise<Result<Record<string, PluginVersion>>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const readCache = deps.readCache ?? realReadUpdateCache;
    const describe = deps.describe ?? realDescribe;
    const exists = deps.exists ?? existsSync;
    const listGit = deps.getPlugins ?? listedPlugins;
    const out: Record<string, PluginVersion> = {};
    const registeredWithoutClone: { id: string; appId: string; dir: string; autoUpdate: boolean; channel?: PluginChannel }[] = [];
    const channelState = deps.channelState ?? realChannelState;
    for (const home of homes) {
      if (!home.present) continue;
      const cache = await readCache(home.dir, home.id);
      const entry = cache.plugins[name];
      const gitEntry = (await listGit(home.dir, home.id)).find((p) => p.id === name);
      const autoUpdate = gitEntry ? gitEntry.autoUpdate !== false : true;
      const repoDir = join(reposDir(home.dir), name);
      if (exists(repoDir)) {
        const channel = await channelState(home.dir, name, home.id);
        out[home.id] = await gitVersionFor(repoDir, entry, describe, autoUpdate, cache.checkedAt ?? null, channel, gitEntry?.channel);
      } else if (entry?.kind === "npm") {
        out[home.id] = { kind: "npm", label: entry.installedVersion, updateState: entry.updateAvailable ? "behind" : "current", autoUpdate: true, onExperimental: false, experimentalAvailable: null };
      } else if (gitEntry) {
        registeredWithoutClone.push({ id: home.id, appId: home.id, dir: home.dir, autoUpdate, channel: gitEntry.channel });
      }
    }
    await markUnknown(out, name, registeredWithoutClone, channelState);
    return out;
  });
}

// One pass over every home computes the version of each installed plugin, so the
// Plugins list can show versions without a per-row round-trip.
export function pluginVersionsAll(deps: PluginVersionsDeps = {}): Promise<Result<Record<string, Record<string, PluginVersion>>>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const readCache = deps.readCache ?? realReadUpdateCache;
    const describe = deps.describe ?? realDescribe;
    const exists = deps.exists ?? existsSync;
    const listGit = deps.getPlugins ?? listedPlugins;
    const listNpm = deps.npmPlugins ?? getNpmPlugins;
    const out: Record<string, Record<string, PluginVersion>> = {};
    const missing: Array<{ name: string; homeId: string; appId: string; dir: string; autoUpdate: boolean; channel?: PluginChannel }> = [];
    const channelState = deps.channelState ?? realChannelState;
    for (const home of homes) {
      if (!home.present) continue;
      const cache = await readCache(home.dir, home.id);
      // Describe every cloned git plugin in this home in parallel so the whole
      // home is one batch of concurrent git subprocesses, not a serial chain.
      const gitEntries = await listGit(home.dir, home.id);
      const described = await Promise.all(
        gitEntries.map(async (p) => {
          const repoDir = join(reposDir(home.dir), p.id);
          if (!exists(repoDir)) return { p, version: null };
          const channel = await channelState(home.dir, p.id, home.id);
          return { p, version: await gitVersionFor(repoDir, cache.plugins[p.id], describe, p.autoUpdate !== false, cache.checkedAt ?? null, channel, p.channel) };
        }),
      );
      for (const { p, version } of described) {
        out[p.id] ??= {};
        if (version) out[p.id][home.id] = version;
        else missing.push({ name: p.id, homeId: home.id, appId: home.id, dir: home.dir, autoUpdate: p.autoUpdate !== false, channel: p.channel });
      }
      for (const p of await listNpm(home.dir, home.id)) {
        const entry = cache.plugins[p.name];
        (out[p.name] ??= {})[home.id] = { kind: "npm", label: entry?.installedVersion ?? null, updateState: entry?.updateAvailable ? "behind" : "current", autoUpdate: true, onExperimental: false, experimentalAvailable: null };
      }
    }
    for (const { name, homeId, appId, dir, autoUpdate, channel } of missing) {
      if (!out[name][homeId]) await markUnknown(out[name], name, [{ id: homeId, appId, dir, autoUpdate, channel }], channelState);
    }
    // Persist all plugins' versions in a single cache write so the next load
    // renders instantly and only rows that actually changed update.
    writeCacheMany(VERSIONS_NS, out, deps.cacheDir ?? getConfigDir());
    return out;
  });
}

export function pluginsInstall(homeId: PluginHomeId, name: string, url: string, deps: PluginsDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const dir = homeDir(homeId, homes);

    // First event in this dispatch's cause scope, so it becomes the trace root every
    // record the install produces chains back to (activityEnv exports it to the
    // separately-bundled updater as HUB_ACTIVITY_PARENT).
    await emitForebayAction({
      action: "plugin_install_requested",
      subject: { kind: "plugin", id: name, label: name },
      homeId,
      details: { url, message: `Installing ${name} into ${homeById(homeId, homes).label}` },
    }, homes);

    const report = deps.report;
    const managesPlugins = deps.managesPlugins ?? managerInstalled;
    // Every home needs the plugin manager before it can manage anything else. The
    // manager itself is exempt: it is what is being installed.
    if (!(await isPluginManager(name, dir)) && !(await managesPlugins(dir, homeId))) {
      report?.("Installing the plugin manager", 10);
      // The bootstrap has to act on the very home this install targets, so it gets this
      // call's home list rather than resolving its own.
      const ensureUpdater = deps.ensureUpdater
        ?? ((id: string) => import("./engines.js").then((m) => m.ensureEngineIn(PLUGIN_MANAGEMENT, id, { homes })));
      const result = await ensureUpdater(homeId);
      if (!result.ok) throw new Error(result.error);
    }

    const installPlugin = deps.installPlugin ?? installPluginRepo;
    let autoUpdateDefault = true;
    const val = getConfigValue("forebay", "autoUpdateDefault");
    if (typeof val === "boolean") autoUpdateDefault = val;
    report?.("Downloading and building", 40);
    await withAttribution(homeId, async () => {
      await installPlugin(dir, name, url, homeId, report);
      report?.("Registering", 90);
      await (deps.registerPlugin ?? realRegisterPlugin)(dir, name, url, homeId);
      // register records the entry; the home's default for auto-updates is Forebay's own setting, so
      // it is applied as a second call rather than smuggled into the contract's register.
      if (!autoUpdateDefault) await (deps.setPluginAutoUpdate ?? realSetPluginAutoUpdate)(dir, name, false, homeId);
    });

    // An app loads the manager through its own config, so a clone alone would leave a
    // manager that is installed but never runs.
    if ((await isPluginManager(name, dir)) && homeId !== "forebay") {
      report?.("Registering with the app", 93);
      await (deps.registerWithApp ?? realRegisterWithApp)(dir, homeId, name);
    }

    if (homeId !== "forebay") {
      report?.("Syncing to other apps", 95);
      const syncPluginsAcrossApps = deps.syncPluginsAcrossApps ?? realSyncPluginsAcrossApps;
      await syncPluginsAcrossApps(dir, homeId);
    }
  });
}

export function pluginsRemoveEverywhere(name: string, deps: PluginsDeps = {}): Promise<Result<InstallManyResult>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const outcomes: InstallOutcome[] = [];
    for (const home of homes) {
      const installed = (await (deps.getPlugins ?? listedPlugins)(home.dir, home.id)).some((entry) => entry.id === name);
      if (!installed) continue;
      const res = await pluginsUninstall(home.id, name, deps);
      outcomes.push(res.ok ? { home: home.id, ok: true } : { home: home.id, ok: false, error: res.error });
    }
    return { outcomes };
  });
}

export function pluginsSetEnabled(homeId: PluginHomeId, name: string, on: boolean, deps: PluginsDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const dir = homeDir(homeId, homes);
    const result = await (deps.setPluginEnabled ?? realSetPluginEnabled)(dir, name, on, homeId);
    if (result === null) throw new Error(`nothing manages the plugins of ${homeId}`);
    if (!result) throw new Error(`plugin not found: ${name}`);
    await emitForebayAction({
      action: on ? "plugin_enabled" : "plugin_disabled",
      subject: { kind: "plugin", id: name, label: name },
      homeId,
      details: { message: `${on ? "Enabled" : "Disabled"} ${name}` },
    }, homes);
  });
}

export function pluginsSetAutoUpdate(homeId: PluginHomeId, name: string, on: boolean, deps: PluginsDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const dir = homeDir(homeId, homes);
    const result = await (deps.setPluginAutoUpdate ?? realSetPluginAutoUpdate)(dir, name, on, homeId);
    if (result === null) throw new Error(`nothing manages the plugins of ${homeId}`);
    if (!result) throw new Error(`plugin not found: ${name}`);
    await emitForebayAction({
      action: "plugin_autoupdate_changed",
      subject: { kind: "plugin", id: name, label: name },
      homeId,
      details: { autoUpdate: on, message: `Auto-update ${on ? "on" : "off"} for ${name}` },
    }, homes);
  });
}

export function pluginsSetChannel(homeId: PluginHomeId, name: string, channel: PluginChannel, deps: PluginsDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const dir = homeDir(homeId, homes);
    const setChannel = deps.setPluginChannel ?? realSetPluginChannel;
    const result = await setChannel(dir, name, channel, homeId);
    if (result === null) throw new Error(`nothing manages the plugins of ${homeId}`);
    if (!result) throw new Error(`plugin not found: ${name}`);
    await emitForebayAction({
      action: "plugin_channel_changed",
      subject: { kind: "plugin", id: name, label: name },
      homeId,
      details: { channel, message: `${name} now tracks ${channel === "experimental" ? "experimental" : "stable"}` },
    }, homes);
  });
}

export function pluginsDowngrade(homeId: PluginHomeId, name: string, hash: string, deps: PluginsDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const dir = homeDir(homeId, homes);
    const plugin = (await (deps.getPlugins ?? listedPlugins)(dir, homeId)).find((entry) => entry.id === name);
    if (!plugin) throw new Error(`plugin not found: ${name}`);
    const downgrade = deps.downgrade ?? ((target: string, version: string, appId: string) =>
      invokePluginManagement(dir, appId, "downgrade", null, (capability) => capability.downgrade(target, version)));
    const outcome = await downgrade(name, hash, homeId);
    if (!outcome) throw new Error(`nothing manages the plugins of ${homeId}`);
    if (!outcome.ok) throw new Error(outcome.message ?? `could not move ${name} to ${hash}`);
  });
}

export function pluginsUninstall(homeId: string, name: string, deps: PluginsDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const dir = homeDir(homeId as PluginHomeId, homes);
    if ((await (deps.getPlugins ?? listedPlugins)(dir, homeId)).some((entry) => entry.id === name)) {
      const uninstall = deps.uninstallPlugin ?? ((target: string, appId: string) =>
        invokePluginManagement(dir, appId, "remove", null, (capability) => capability.remove(target)));
      const removed = await uninstall(name, homeId);
      if (!removed) throw new Error(`nothing manages the plugins of ${homeId}`);
      if (!removed.ok) throw new Error(removed.message ?? `could not remove ${name}`);
      // The plugin is gone, so anything only it declared is now dead weight in the shared store.
      await (deps.prune ?? pruneUnusedLibraries)(dir, homeId);
      return;
    }
    const npmList = deps.npmPlugins ?? getNpmPlugins;
    if ((await npmList(dir, homeId)).some((p) => p.name === name)) {
      const uninstallNpm = deps.uninstallNpmPlugin ?? ((target: string, appId: string) =>
        invokePluginManagement(dir, appId, "removeNpm", null, (capability) => capability.removeNpm(target)));
      const removed = await uninstallNpm(name, homeId);
      if (!removed) throw new Error(`nothing manages the plugins of ${homeId}`);
      if (!removed.ok) throw new Error(removed.message ?? `could not remove ${name}`);
      return;
    }
    throw new Error(`plugin not found: ${name}`);
  });
}
