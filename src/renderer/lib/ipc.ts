import type { ForebayAPI } from "@forebay/shared";
import { cached, invalidate } from "./cache.js";

declare global {
  interface Window {
    forebay: ForebayAPI;
  }
}

// Read methods go through the client cache (name -> TTL ms). A method that is
// neither a cached read, a live read, nor a passthrough is taken to be a mutation
// and invalidates the cache after it runs, so the next read is fresh.
const READ_TTL: Record<string, number> = {
  overviewSummary: 30000,
  accountsList: 30000,
  providersList: 30000,
  routingApps: 30000,
  routingGet: 30000,
  proxyStatus: 10000,
  appsDetect: 30000,
  appsList: 60000,
  appsSummary: 30000,
  appStorageGet: 15000,
  pluginsList: 30000,
  pluginsListCached: 10000,
  pluginsData: 10000,
  librariesList: 30000,
  configSchemas: 30000,
  getConfig: 30000,
  usageSnapshot: 120000,
  importApps: 30000,
  importPreview: 15000,
  catalogList: 60000,
  customEndpointsList: 30000,
  screensList: 30000,
  settingsSections: 30000,
  githubStatus: 15000,
  activityRead: 10000,
};

// Reads that must not be cached: each is either wanted live (jobsList backs the
// Downloads panel, where a stale answer freezes visible progress) or already
// answered from a cache the sidecar owns. They read nothing else stale, so unlike a
// mutation they leave the rest of the cache alone.
const LIVE_READS = new Set([
  "proxiesList",
  "jobsList",
  "appsConnection",
  "repoMeta",
  "repoMetaCached",
  "pluginVersions",
  "pluginVersionsAll",
  "pluginVersionsCached",
  "enginesList",
  "screenData",
  "activityStats",
  "globalSettingsRead",
  "catalogListCached",
  "favoritesList",
  "marketplaceSourcesList",
  "customEndpointsFormats",
  "pluginLedger",
  "pluginQuarantine",
]);

// Methods that return synchronously: the window controls return nothing, and a push
// subscription returns its unsubscribe function. Wrapping either as an async mutation
// would turn that unsubscribe into a Promise of one.
const PASSTHROUGH = new Set([
  "minimize",
  "maximize",
  "close",
  "onServerStatus",
  "onDownloadProgress",
  "onActivityEvent",
  "onJobEvent",
]);

export type IpcKind = "cached" | "live" | "passthrough" | "mutation";

// Exported so a test can hold the full expected classification: leaving a read out of
// the tables above is silent otherwise, and costs every other screen its cache.
export function classify(name: string): IpcKind {
  if (name in READ_TTL) return "cached";
  if (LIVE_READS.has(name)) return "live";
  if (PASSTHROUGH.has(name)) return "passthrough";
  return "mutation";
}

// Exported so a test can check the opposite drift: a name placed in either table with
// no matching INVOKE_CHANNELS entry resolves window.forebay[name] to undefined at runtime,
// silently, since the proxy's own guard only skips non-functions rather than reporting them.
export function classifiedReadNames(): string[] {
  return [...Object.keys(READ_TTL), ...LIVE_READS];
}

export const forebay: ForebayAPI = new Proxy({} as ForebayAPI, {
  get(_target, property) {
    const name = property as string;
    const real = (window.forebay as unknown as Record<string | symbol, unknown>)?.[property];
    if (typeof real !== "function") return real;
    const bound = (real as (...args: unknown[]) => unknown).bind(window.forebay);
    switch (classify(name)) {
      case "cached":
        return (...args: unknown[]) => cached(name + ":" + JSON.stringify(args), READ_TTL[name], () => bound(...args) as Promise<unknown>);
      case "live":
      case "passthrough":
        return bound;
      case "mutation":
        return async (...args: unknown[]) => {
          const result = await bound(...args);
          invalidate();
          return result;
        };
    }
  },
});
