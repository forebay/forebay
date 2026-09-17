import { getConfigValue } from "@intisy-ai/basekit";
import { invokeLibraryManagement, readLibraryManagement } from "../lib/pluginManager.js";

const CONFIG_NAME = "forebay";
const CONFIG_KEY = "pruneUnusedLibraries";

// Uninstalling a plugin leaves the libraries it put in the home's shared store behind. That is
// how a home came to keep offering a wire format after the only plugin that used it was gone.
// On by default, because a library nothing declares is dead weight that still answers "what is
// installed"; switchable off for a home that installs libraries by hand.
export function prunesUnusedLibraries(): boolean {
  return getConfigValue(CONFIG_NAME, CONFIG_KEY) !== false;
}

export interface PruneDeps {
  enabled?: () => boolean;
  orphans?: (dir: string, appId: string) => Promise<string[]>;
  remove?: (dir: string, specifier: string, appId: string) => Promise<void>;
}

// A shared library nothing declares any more, derived rather than asked for: `usedBy` already says
// who declares each one, so a home reporting its libraries has answered this too.
async function orphanedLibraries(dir: string, appId: string): Promise<string[]> {
  const reading = await readLibraryManagement(dir, appId, "libraries", null, (capability) => capability.libraries());
  return (reading?.shared ?? []).filter((library) => library.usedBy.length === 0).map((library) => library.specifier);
}

// Removes every library in this home's store that no installed plugin declares any more.
// Returns what went, so the caller can say so rather than silently changing the home.
export async function pruneUnusedLibraries(dir: string, appId: string, deps: PruneDeps = {}): Promise<string[]> {
  if (!(deps.enabled ?? prunesUnusedLibraries)()) return [];

  const orphans = deps.orphans ?? orphanedLibraries;
  const remove = deps.remove ?? (async (home: string, specifier: string, app: string) => {
    await invokeLibraryManagement(home, app, "remove", null, (capability) => capability.remove(specifier));
  });

  const removed: string[] = [];
  for (const specifier of await orphans(dir, appId)) {
    try {
      await remove(dir, specifier, appId);
      removed.push(specifier);
    } catch {
      // A library that will not delete (held open on Windows, say) is not worth failing the
      // uninstall that already succeeded over.
    }
  }
  return removed;
}
