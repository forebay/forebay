import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogEntriesFor, repoProvidingCapability } from "./capabilityCatalog.js";
import { CATALOG_CACHE_FILE } from "@intisy-ai/basekit/loader/capability-catalog.js";
import { pathsForHome } from "./storagePaths.js";

// Pinned so the registry lookup behind pathsForHome() cannot read the developer's real apps.json.
// HUB_APPS_FILE is the one that matters here; it is read live per call, so no reimport is needed.
const registryHome = mkdtempSync(join(tmpdir(), "forebay-catreg-"));
process.env.HUB_CONFIG_DIR = registryHome;
process.env.HUB_APPS_FILE = join(registryHome, "apps.json");

const entry = (id: string, capabilities: string[]) => ({
  id, npmName: id, url: `https://github.com/example/${id}`, capabilities,
  description: "", sourceId: "example",
});

// catalogFor's freshness check reads the cache file from real disk unconditionally
// (basekit/loader's readJson, not deps.readFileFn, which only backs a "local" marketplace
// source). A fixture catalog is staged the same way, at the same path.
function homeWithCache(entries: ReturnType<typeof entry>[]): string {
  const home = mkdtempSync(join(tmpdir(), "forebay-cat-"));
  const cacheDir = pathsForHome(home).cache;
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, CATALOG_CACHE_FILE), JSON.stringify({ time: 0, entries }));
  return home;
}

describe("the capability catalog for one home", () => {
  it("names the repository whose manifest declares a capability", async () => {
    const home = homeWithCache([entry("alpha", ["screens"]), entry("manager", ["plugin-management"])]);
    const found = await repoProvidingCapability(home, "plugin-management", {
      fetchJson: async () => null,
      now: () => 0,
    });
    expect(found?.id).toBe("manager");
    expect(found?.url).toBe("https://github.com/example/manager");
  });

  it("answers null for a capability nothing offers", async () => {
    const home = homeWithCache([entry("alpha", ["screens"])]);
    const found = await repoProvidingCapability(home, "nothing-offers-this", {
      fetchJson: async () => null,
      now: () => 0,
    });
    expect(found).toBeNull();
  });

  it("answers an empty list rather than throwing when every source fails", async () => {
    const home = mkdtempSync(join(tmpdir(), "forebay-cat-"));
    expect(await catalogEntriesFor(home, { fetchJson: async () => null, now: () => 0 })).toEqual([]);
  });
});
