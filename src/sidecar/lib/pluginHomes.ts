import { homedir } from "node:os";
import { getApps, getAppDescriptor, resolveHome } from "@intisy-ai/basekit";
import { resolveStoreDir } from "../../main/lib/storeDir.js";
import { appsDetect } from "../modules/apps.js";
import { renderForebayMark } from "../../../packages/shared/src/logo.js";
import { svgIconDataUri } from "./pluginIcon.js";
import type { AppPresence, PluginHome, PluginHomeId, Result } from "../../../packages/shared/src/domain.js";
import { hasCapability, listedPlugins, PLUGIN_MANAGEMENT } from "./pluginManager.js";

export function appRealHome(app: string, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const desc = getAppDescriptor(app, env, home);
  return desc ? resolveHome(desc, env, home) : "";
}

// Forebay's OWN home: the store directory main launches the sidecar against, holding its
// config, repos, accounts and logs. Anything about Forebay itself (its plugin home, where
// an install lands, the home its activity is stamped with and its background updates run
// against) asks here, and gets the same directory `HUB_CONFIG_DIR` already points every
// other sidecar path at.
//
// @implNote Neither of the two directories this used to name will do. basekit/auth's
// getConfigDir falls back to the ACTIVE APP's home when HUB_CONFIG_DIR is unset, which
// once made "install into Forebay" write into Claude's home. The app registry's directory
// is a fixed global path so loaders and providers inside Claude or OpenCode can find it
// without HUB_CONFIG_DIR, and naming it here pointed the plugin list, installs and
// background updates at a directory nothing else ever wrote to.
export function forebayHome(): string {
  const forced = process.env.HUB_CONFIG_DIR?.trim();
  return forced || resolveStoreDir(process.env, process.platform, homedir());
}

/**
 * Whether this home can install and update plugins at all, which is what the gate and the download
 * source label both hinge on.
 *
 * @remarks
 * Asked as a capability rather than by looking for a particular plugin in the home's lists. That is
 * both the agnostic question and the more accurate one: a manager present but not loadable here
 * cannot be called, so a list saying it is installed would gate the UI open on a home where nothing
 * would answer.
 */
export async function managerInstalled(dir: string, appId: string): Promise<boolean> {
  try {
    return await hasCapability(dir, appId, PLUGIN_MANAGEMENT);
  } catch {
    return false;
  }
}

// An app is connected through its loader, so a home whose loader is absent cannot load
// anything the ecosystem installs there. Both the Apps view and the plugin home list ask
// this, and a second copy of the rule is how the two came to disagree elsewhere.
export async function loaderInstalled(
  dir: string,
  loaderId?: string,
  appId = "",
  listPlugins: (dir: string, app: string) => Array<{ id: string }> | Promise<Array<{ id: string }>> = listedPlugins,
): Promise<boolean> {
  if (!loaderId) return false;
  try {
    return (await listPlugins(dir, appId)).some((plugin) => plugin.id === loaderId);
  } catch {
    return false;
  }
}

export interface PluginHomesDeps {
  detect?: () => Promise<Result<AppPresence>>;
  forebayDir?: string;
  managesPlugins?: (dir: string, appId: string) => boolean | Promise<boolean>;
  hasLoader?: (dir: string, loaderId?: string, appId?: string) => boolean | Promise<boolean>;
  appHome?: (app: string) => string;
}

export async function pluginHomes(deps: PluginHomesDeps = {}): Promise<PluginHome[]> {
  const detect = deps.detect ?? appsDetect;
  const managesPlugins = deps.managesPlugins ?? managerInstalled;
  const hasLoader = deps.hasLoader ?? loaderInstalled;
  const forebayDir = deps.forebayDir ?? forebayHome();
  const appHomeForId = deps.appHome ?? appRealHome;
  const detected = await detect();
  const present: AppPresence = detected.ok ? detected.data : {};
  const appHomes: PluginHome[] = await Promise.all(
    getApps().map(async (desc) => {
      const dir = appHomeForId(desc.id);
      return {
        id: desc.id,
        label: desc.label,
        icon: desc.icon ? svgIconDataUri(desc.icon) : undefined,
        dir,
        present: !!present[desc.id],
        managesPlugins: await managesPlugins(dir, desc.id),
        loaderId: desc.loader?.id,
        loaderInstalled: await hasLoader(dir, desc.loader?.id, desc.id),
      };
    }),
  );
  return [
    // Forebay's own home is a home like any other: until something providing plugin-management is
    // installed into it, the only plugin it can gain is one that provides a capability itself.
    { id: "forebay", label: "Forebay", icon: renderForebayMark(), dir: forebayDir, present: true, managesPlugins: await managesPlugins(forebayDir, "forebay") },
    ...appHomes,
  ];
}

export function homeById(homeId: PluginHomeId, homes: PluginHome[]): PluginHome {
  const home = homes.find((h) => h.id === homeId);
  if (!home) throw new Error(`unknown plugin home: ${homeId}`);
  return home;
}

export function homeDir(homeId: PluginHomeId, homes: PluginHome[]): string {
  return homeById(homeId, homes).dir;
}
