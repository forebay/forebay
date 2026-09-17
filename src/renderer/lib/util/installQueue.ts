import { PLUGIN_MANAGEMENT } from "@forebay/shared";
import type { EngineView, PluginHome } from "@forebay/shared";

export interface PrerequisiteInstall {
  homeId: string;
  id: string;
  url: string;
}

// A home cannot manage a plugin before it has a plugin manager, so Forebay installs the
// manager first, as its own download. Selected by capability: Forebay names no plugin.
export function prerequisiteInstalls(
  name: string,
  homeIds: string[],
  homes: PluginHome[],
  engines: EngineView[],
): PrerequisiteInstall[] {
  if (engines.some((e) => e.id === name)) return [];
  const manager = engines.find((e) => e.capability === PLUGIN_MANAGEMENT);
  if (!manager) return [];
  const byId = Object.fromEntries(homes.map((h) => [h.id, h]));
  return homeIds
    .filter((id) => byId[id] && !byId[id].managesPlugins)
    .map((homeId) => ({ homeId, id: manager.id, url: manager.url }));
}
