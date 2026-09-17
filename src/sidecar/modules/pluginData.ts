import type { HomePluginData, PluginDataEntry, PluginHome, Result } from "../../../packages/shared/src/domain.js";
import { pluginHomes } from "../lib/pluginHomes.js";
import { invokePluginManagement, readPluginManagement } from "../lib/pluginManager.js";
import { deployedManifests } from "../lib/capabilityOwner.js";
import { wrap } from "../result.js";

export interface PluginDataDeps {
  homes?: PluginHome[];
  read?: (dir: string, plugin: string, declared: string[], appId: string) => Promise<PluginDataEntry[]>;
  declaredPaths?: (dir: string, plugin: string) => string[];
}

// Most of what a plugin leaves behind is found by name, but a plugin writing outside that
// convention says where in its manifest. Read from the deployed sidecar rather than asked of the
// plugin, because an uninstall is the surface that needs it most and the plugin is on its way out.
function realDeclaredPaths(dir: string, plugin: string): string[] {
  return deployedManifests(dir).find((deployed) => deployed.id === plugin)?.dataPaths ?? [];
}

// Finding and deleting a plugin's data belongs to whatever put it there, for the same reason
// reading the library store does. A home with nothing managing its plugins has nothing to report
// and nothing to delete.
function realRead(dir: string, plugin: string, declared: string[], appId: string): Promise<PluginDataEntry[]> {
  return readPluginManagement(dir, appId, "data", [], (capability) => capability.data(plugin, declared));
}

// What this plugin would leave behind in each home, so a confirmation can name it before
// anything is deleted. A home holding nothing of the plugin's is left out.
export function pluginsData(name: string, deps: PluginDataDeps = {}): Promise<Result<HomePluginData[]>> {
  return wrap(async () => {
    const homes = deps.homes ?? (await pluginHomes());
    const read = deps.read ?? realRead;
    const declaredPaths = deps.declaredPaths ?? realDeclaredPaths;

    const found: HomePluginData[] = [];
    for (const home of homes) {
      if (home.id !== "forebay" && !home.present) continue;
      const entries = await read(home.dir, name, declaredPaths(home.dir, name), home.id);
      if (entries.length > 0) found.push({ home, entries });
    }
    return found;
  });
}

export interface RemoveDataDeps {
  homes?: PluginHome[];
  remove?: (dir: string, paths: string[], appId: string) => Promise<string[]>;
}

// Deletes exactly the paths pluginsData reported and the confirmation listed. The caller
// passes them back rather than the plugin name because the declaration saying where a plugin
// keeps state lives in the plugin's own bundle: after an uninstall there is nothing left to
// ask. The manager re-checks every path against the home before deleting it.
export function pluginsRemoveData(homeId: string, paths: string[], deps: RemoveDataDeps = {}): Promise<Result<string[]>> {
  return wrap(async () => {
    const homes = deps.homes ?? (await pluginHomes());
    const home = homes.find((candidate) => candidate.id === homeId);
    if (!home) throw new Error(`unknown home: ${homeId}`);
    const remove = deps.remove ?? ((dir: string, targets: string[], appId: string) =>
      invokePluginManagement(dir, appId, "removeData", [], (capability) => capability.removeData(targets)));
    return remove(home.dir, paths, home.id);
  });
}
