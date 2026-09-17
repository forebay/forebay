import type { PluginConfigSchema, PluginHome, PluginScreen, PluginSettingsSection, Result } from "../../../packages/shared/src/domain.js";
import { pluginHomes } from "../lib/pluginHomes.js";
import { readCache, writeCache } from "../lib/cache.js";
import { byOrderThenLabel, screenLayoutFor, SCREENS } from "@intisy-ai/basekit";
import type { ScreensCapability } from "@intisy-ai/basekit";
import { getConfigDir } from "@intisy-ai/basekit/auth";
import { configSchemas } from "./appConfig.js";
import { capabilityProviders, callHostCapability, DEFAULT_CALL_TIMEOUT_MS, SURFACE } from "../lib/pluginHost.js";
import { wrap } from "../result.js";

export const CONTRIBUTIONS_NS = "contributions";
const CONTRIBUTIONS_KEY = "contributions";

export interface Contributions {
  screens: PluginScreen[];
  sections: PluginSettingsSection[];
}

export interface ContributionsDeps {
  homes?: PluginHome[];
  schemas?: (homeId: string) => Promise<PluginConfigSchema[]>;
  screensOf?: (homeDir: string, appId: string) => Promise<PluginScreen[]>;
  cacheDir?: string;
}

export interface ContributionsOptions {
  // Collecting contributions means resolving every home's plugin declarations, which on a
  // cold cache costs real time. A screen therefore paints from the last known set and asks
  // for a refresh separately, so a first paint never waits on it.
  wait?: boolean;
}

const EMPTY: Contributions = { screens: [], sections: [] };

async function realSchemas(homeId: string): Promise<PluginConfigSchema[]> {
  const result = await configSchemas(homeId);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** What a plugin providing `screens` answers with, for the fields a screen list needs. */
// Partial rather than core's full capability: the implementation comes from a plugin this process
// did not compile, so the declaration is checked at run time below.
type ScreensDeclaration = Partial<Pick<ScreensCapability, "screens">>;

// A ScreenSpec carries no plugin or home of its own (a plugin declares it once, for itself);
// this is the one place that stamps both on, from the provider record and the home being read.
async function realScreensOf(homeDir: string, appId: string): Promise<PluginScreen[]> {
  const screens: PluginScreen[] = [];
  for (const record of await capabilityProviders(homeDir, appId, SCREENS.id)) {
    const capability = record.implementation as ScreensDeclaration;
    if (typeof capability?.screens !== "function") continue;
    const answer = await callHostCapability(record.pluginId, "screens.screens", DEFAULT_CALL_TIMEOUT_MS, async () => capability.screens!());
    if (!answer.ok) continue;
    for (const spec of Array.isArray(answer.value) ? answer.value : []) {
      if (!spec || typeof spec.id !== "string") continue;
      // The layout this surface gets, which is the plugin's override for it when it declared one.
      // `surfaces` itself stays behind: it is answered now, and a resolved screen carries one layout.
      const { surfaces: _resolved, ...rest } = spec;
      screens.push({ ...rest, layout: screenLayoutFor(spec, SURFACE), plugin: record.pluginId, homes: [appId] });
    }
  }
  return screens;
}

// A plugin asks for UI of its own through two capabilities: `screens` (a nav entry plus a
// nested layout tree) and its `settings` declaration's sections, placed inside the dashboard's
// own settings screen. This collects both across every home the dashboard manages.
// (Not to be confused with a MarketplaceContribution, which is a catalog entry a plugin
// publishes rather than a piece of the dashboard's own UI.)
// A home that cannot be read contributes nothing rather than sinking the whole list: one
// broken bundle must not cost the user every other plugin's contribution, and a failure
// reading one of the two capabilities must not cost the other.
async function collect(deps: ContributionsDeps): Promise<Contributions> {
  const homes = deps.homes ?? (await pluginHomes());
  const schemas = deps.schemas ?? realSchemas;
  const screensOf = deps.screensOf ?? realScreensOf;
  const screens = new Map<string, PluginScreen>();
  const sections = new Map<string, PluginSettingsSection>();

  for (const home of homes) {
    if (home.id !== "forebay" && !home.present) continue;

    try {
      for (const spec of await screensOf(home.dir, home.id)) {
        const key = `${spec.plugin}:${spec.id}`;
        const existing = screens.get(key);
        if (existing) { existing.homes.push(home.id); continue; }
        screens.set(key, { ...spec, homes: [...spec.homes] });
      }
    } catch {
      // one broken screens capability must not cost this home's settings sections
    }

    let found: PluginConfigSchema[];
    try {
      found = await schemas(home.id);
    } catch {
      continue;
    }
    for (const schema of found) {
      for (const spec of schema.sections ?? []) {
        const key = `${schema.plugin}:${spec.id}`;
        const existing = sections.get(key);
        if (existing) { existing.homes.push(home.id); continue; }
        const { fields: _fields, actions: _actions, ...rest } = spec;
        sections.set(key, { ...rest, plugin: schema.plugin, homes: [home.id] });
      }
    }
  }

  return {
    screens: [...screens.values()].sort(byOrderThenLabel),
    sections: [...sections.values()].sort(byOrderThenLabel),
  };
}

// Two callers arriving together (the sidebar remounting, the settings screen) share one pass.
let inFlight: Promise<Contributions> | null = null;

function refresh(deps: ContributionsDeps, cacheDir: string): Promise<Contributions> {
  if (inFlight) return inFlight;
  inFlight = collect(deps)
    .then((contributions) => {
      writeCache(CONTRIBUTIONS_NS, CONTRIBUTIONS_KEY, contributions, cacheDir);
      return contributions;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// A cache written by a pre-upgrade build carries the old { menus, sections } shape. Trusting
// it as-is would hand a caller `screens: undefined`, so the shape is checked, not just presence.
function isContributions(value: unknown): value is Contributions {
  const v = value as Partial<Contributions> | null;
  return !!v && Array.isArray(v.screens) && Array.isArray(v.sections);
}

function read(opts: ContributionsOptions, deps: ContributionsDeps): Promise<Contributions> {
  const cacheDir = deps.cacheDir ?? getConfigDir();
  if (opts.wait) return refresh(deps, cacheDir);
  const cached = readCache<Contributions>(CONTRIBUTIONS_NS, CONTRIBUTIONS_KEY, cacheDir)?.value;
  return Promise.resolve(isContributions(cached) ? cached : EMPTY);
}

export function screensList(opts: ContributionsOptions = {}, deps: ContributionsDeps = {}): Promise<Result<PluginScreen[]>> {
  return wrap(async () => (await read(opts, deps)).screens);
}

export function settingsSections(opts: ContributionsOptions = {}, deps: ContributionsDeps = {}): Promise<Result<PluginSettingsSection[]>> {
  return wrap(async () => (await read(opts, deps)).sections);
}

export function resetContributionsForTests(): void {
  inFlight = null;
}
