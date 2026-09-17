import type { HomeLibraries, UnifiedLibrary } from "@forebay/shared";

// One row per library rather than one per home. A library installed in three homes was listed
// three times, which read as three libraries; the homes belong beside it, the way a plugin's do.
//
// A version is kept per home because they genuinely can differ, and a row that showed one
// version would be claiming something it cannot know.
export function buildUnifiedLibraries(homes: HomeLibraries[]): UnifiedLibrary[] {
  const bySpecifier = new Map<string, UnifiedLibrary>();

  function entryFor(specifier: string): UnifiedLibrary {
    let entry = bySpecifier.get(specifier);
    if (!entry) {
      entry = { specifier, homes: {}, usedBy: [], declaredBy: [] };
      bySpecifier.set(specifier, entry);
    }
    return entry;
  }

  function stateFor(entry: UnifiedLibrary, homeId: string, version: string, installed: boolean) {
    const existing = entry.homes[homeId];
    if (existing) {
      if (installed) existing.installed = true;
      if (!existing.version) existing.version = version;
      return existing;
    }
    return (entry.homes[homeId] = { version, installed, usedBy: [] });
  }

  for (const home of homes) {
    for (const library of home.shared) {
      const entry = entryFor(library.specifier);
      const state = stateFor(entry, home.home.id, library.version, true);
      for (const plugin of library.usedBy) {
        if (!state.usedBy.includes(plugin)) state.usedBy.push(plugin);
        if (!entry.usedBy.includes(plugin)) entry.usedBy.push(plugin);
      }
    }
    // A plugin's own declared dependency is not in the shared store, so it is recorded as a
    // declaration rather than an installation: the row still names it, and still says nobody
    // put it in the store.
    for (const group of home.plugins) {
      for (const library of group.dependencies) {
        const entry = entryFor(library.specifier);
        const state = stateFor(entry, home.home.id, library.version, false);
        if (!entry.declaredBy.includes(group.plugin)) entry.declaredBy.push(group.plugin);
        if (!state.usedBy.includes(group.plugin)) state.usedBy.push(group.plugin);
        if (!entry.usedBy.includes(group.plugin)) entry.usedBy.push(group.plugin);
      }
    }
  }

  for (const entry of bySpecifier.values()) {
    entry.usedBy.sort();
    entry.declaredBy.sort();
    for (const state of Object.values(entry.homes)) state.usedBy.sort();
  }
  return [...bySpecifier.values()].sort((a, b) => a.specifier.localeCompare(b.specifier));
}

// A library nothing declares is removable on its own; one in use goes when its consumers do.
export function isOrphan(library: UnifiedLibrary): boolean {
  return library.usedBy.length === 0;
}

// The homes holding it where nothing declares it. A library can be load-bearing in one home
// and left over in another (uninstalling its last consumer there leaves the store entry), so
// removal targets those homes rather than every home holding it.
export function orphanHomeIds(library: UnifiedLibrary): string[] {
  return Object.entries(library.homes)
    .filter(([, state]) => state.installed && state.usedBy.length === 0)
    .map(([homeId]) => homeId)
    .sort();
}
