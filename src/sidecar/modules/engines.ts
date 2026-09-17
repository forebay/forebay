import { pluginHomes, homeById } from "../lib/pluginHomes.js";
import { ownerOfCapability } from "../lib/capabilityOwner.js";
import { catalogEntriesFor } from "../lib/capabilityCatalog.js";
import type { CatalogEntry } from "../lib/capabilityCatalog.js";
import type { EngineView, EngineHomeState, PluginHome, PluginHomeId, Result } from "../../../packages/shared/src/domain.js";
import { wrap } from "../result.js";

export interface EnginesDeps {
  homes?: PluginHome[];
  catalog?: (homeDir: string) => Promise<CatalogEntry[]>;
  ownerIn?: (homeDir: string, capability: string) => string | null;
  pluginsInstall?: (homeId: string, name: string, url: string, deps?: { homes?: PluginHome[] }) => Promise<Result<void>>;
}

/** The plugin providing a capability in one home, or null. Nothing here names a plugin. */
export function pluginOwningCapability(capability: string, homeDir: string): string | null {
  return ownerOfCapability(homeDir, capability);
}

async function resolveHomes(deps: EnginesDeps): Promise<PluginHome[]> {
  return deps.homes ?? (await pluginHomes());
}

function stateIn(homeDir: string, capability: string, ownerIn: (dir: string, id: string) => string | null): EngineHomeState {
  const owner = ownerIn(homeDir, capability);
  return { installed: !!owner, enabled: !!owner };
}

/**
 * One entry per capability any source offers, keyed by capability rather than by repository.
 *
 * @remarks
 * A capability two repositories provide is one row, and the first offer in `entries` wins the
 * install target. The vocabulary comes from the entries present; nothing here enumerates
 * capability ids.
 */
function offersByCapability(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  const offers = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    for (const capability of entry.capabilities) {
      if (!offers.has(capability)) offers.set(capability, entry);
    }
  }
  return offers;
}

/**
 * @remarks
 * Reads every home's OWN declared marketplace sources rather than seeding from one: a capability
 * offered only through a non-Forebay home's sources would otherwise never appear as a row, even
 * though installing it into that home would work. `catalogEntriesFor` caches per home, so this
 * costs one cached read per home rather than one fetch per home.
 */
export function enginesList(deps: EnginesDeps = {}): Promise<Result<EngineView[]>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const catalog = deps.catalog ?? catalogEntriesFor;
    const ownerIn = deps.ownerIn ?? ownerOfCapability;
    const entries = (await Promise.all(homes.map((home) => catalog(home.dir)))).flat();
    const offers = offersByCapability(entries);
    return [...offers.entries()].map(([capability, entry]) => ({
      id: entry.id,
      capability,
      url: entry.url,
      homes: Object.fromEntries(homes.map((home) => [home.id, stateIn(home.dir, capability, ownerIn)])),
    }));
  });
}

/**
 * Installs the plugin providing a capability into ONE named home, when that home has none.
 *
 * @remarks
 * The home is resolved from every home Forebay manages rather than from a target list: a capability
 * that normally belongs to an app home is still needed in Forebay's own home once something there has
 * to be managed.
 */
export function ensureEngineIn(capability: string, homeId: string, deps: EnginesDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const home = homeById(homeId as PluginHomeId, homes);
    const ownerIn = deps.ownerIn ?? ownerOfCapability;
    if (ownerIn(home.dir, capability)) return;
    const catalog = deps.catalog ?? catalogEntriesFor;
    const entry = offersByCapability(await catalog(home.dir)).get(capability);
    if (!entry) throw new Error(`no marketplace source offers a plugin providing ${capability}`);
    const install = deps.pluginsInstall ?? (await import("./plugins.js")).pluginsInstall;
    const result = await install(home.id, entry.id, entry.url, { homes });
    if (!result.ok) throw new Error(result.error);
  });
}

export function ensureEngine(capability: string, deps: EnginesDeps = {}): Promise<Result<void>> {
  return wrap(async () => {
    const homes = await resolveHomes(deps);
    const home = homes[0];
    if (!home) throw new Error(`no home to install ${capability} into`);
    const result = await ensureEngineIn(capability, home.id, { ...deps, homes });
    if (!result.ok) throw new Error(result.error);
  });
}
