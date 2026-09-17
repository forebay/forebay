// Proves the install flow against throwaway homes, exercising the DEFAULT wiring that
// unit tests replace with injected seams. That is the class of bug this flow has hit
// twice, so it gets a live check: real clones, real registration, real activity records.
//
// Not part of the normal suite (the filename does not end in .test.ts, which is what
// vitest.config.ts includes). Run it deliberately:
//   npx vitest run --config vitest.live.config.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHome } from "../../../packages/shared/src/domain.js";
import { reposDir, pluginDir } from "../lib/storagePaths.js";

const CLONE_TIMEOUT_MS = 300_000;

// Measures the SAME credential the catalog resolves (GH_TOKEN/GITHUB_TOKEN, else anonymous).
// A probe that always asked anonymously reported an exhausted limit even on authenticated runs,
// which hid whether the token had reached the catalog at all.
async function whyCatalogMightBeEmpty(homeDir: string): Promise<string> {
  const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  const credential = token ? "authenticated" : "anonymous";
  try {
    const limit = (await (await fetch("https://api.github.com/rate_limit", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })).json()) as { resources: { core: { remaining: number; reset: number } } };
    const core = limit.resources.core;
    const { catalogEntriesFor } = await import("../lib/capabilityCatalog.js");
    const entries = await catalogEntriesFor(homeDir);
    const detail = `The ${credential} GitHub budget has ${core.remaining} requests left and the catalog returned ${entries.length} entries.`;
    if (core.remaining === 0) {
      const minutes = Math.max(1, Math.round((core.reset * 1000 - Date.now()) / 60_000));
      return `${detail} The budget is exhausted, resetting in about ${minutes} minutes, so that is the cause rather than a missing plugin. Set GH_TOKEN to raise it.`;
    }
    if (entries.length === 0) return `${detail} The budget is not the cause, so the org scan itself returned nothing.`;
    return `${detail} The budget is not the cause and the catalog is populated, so no entry declares plugin-management: check the repo's category topic against classifyRepoTopics.`;
  } catch {
    return `GitHub was unreachable over the ${credential} credential, so the cause could not be determined.`;
  }
}

let root: string;
let homes: PluginHome[];
let manager: { id: string; url: string };

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "forebay-install-flow-"));
  homes = [
    { id: "forebay", label: "Forebay", dir: join(root, "forebay"), present: true, managesPlugins: false },
    { id: "claude", label: "Claude Code", dir: join(root, "claude"), present: true, managesPlugins: false },
    { id: "opencode", label: "OpenCode", dir: join(root, "opencode"), present: true, managesPlugins: false },
  ];
  // Every ambient resolution must land inside the temp root, never a real home.
  process.env.HUB_CONFIG_DIR = homes[0].dir;

  const { repoProvidingCapability } = await import("../lib/capabilityCatalog.js");
  const found = await repoProvidingCapability(homes[0].dir, "plugin-management");
  // repoProvidingCapability catches everything and returns null, so an exhausted GitHub rate limit
  // is indistinguishable from a genuinely absent plugin. Naming the real cause here stops the next
  // reader hunting for a metadata problem that is not there.
  if (!found) throw new Error(`no plugin providing plugin-management was found. ${await whyCatalogMightBeEmpty(homes[0].dir)}`);
  manager = { id: found.id, url: found.url };
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

// syncPluginsAcrossApps is the one seam still injected: the real one reconciles
// plugins.json across the machine's REAL app homes, which a test must never touch.
async function installManager(homeId: string): Promise<{ ok: boolean; error?: string }> {
  const { pluginsInstall } = await import("../modules/plugins.js");
  return pluginsInstall(homeId as never, manager.id, manager.url, {
    homes,
    syncPluginsAcrossApps: async () => {},
  });
}

describe.each(["claude", "opencode"])("installing the plugin manager into the %s home", (homeId) => {
  it("really installs it and then reports it as installed", async () => {
    const home = homes.find((h) => h.id === homeId)!;
    const result = await installManager(homeId);
    expect(result.ok, result.ok ? "" : String(result.error)).toBe(true);

    expect(existsSync(join(reposDir(home.dir), manager.id)), "clone exists").toBe(true);
    expect(existsSync(join(pluginDir(home.dir), `${manager.id}.js`)), "bundle deployed").toBe(true);

    // The sidecar is what makes a deployed plugin's identity and capabilities readable from disk
    // without importing it, so a home without one is invisible to every manifest-driven surface.
    const sidecarPath = join(pluginDir(home.dir), `${manager.id}.json`);
    expect(existsSync(sidecarPath), "manifest sidecar written").toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as { id: string; api: number; capabilities?: string[] };
    expect(sidecar.id, "sidecar names the deployed plugin").toBe(manager.id);
    expect(typeof sidecar.api, "sidecar declares an api floor").toBe("number");

    // The whole chain, not just the file: a host scanning this home must actually see the plugin.
    const { readDeployedManifests } = await import("@intisy/bayonet/host");
    const scan = readDeployedManifests(pluginDir(home.dir));
    expect(scan.failed.map((f) => f.detail), "no sidecar failed to validate").toEqual([]);
    expect(scan.loaded.map((p) => p.manifest.id), "the scan finds the manager").toContain(manager.id);

    const registered = JSON.parse(readFileSync(join(home.dir, "config", "plugins.json"), "utf8")) as Array<{ name: string }>;
    expect(registered.some((p) => p.name === manager.id), "registered in plugins.json").toBe(true);

    // The bug this whole change exists to fix: the home used to report false here. It is asked as
    // a capability now, so this also proves the deployed manager is one a host can actually call.
    const { managerInstalled } = await import("../lib/pluginHomes.js");
    expect(await managerInstalled(home.dir, home.id), "home reports the manager as installed").toBe(true);
  }, CLONE_TIMEOUT_MS);
});

describe("the app's own registration", () => {
  it("writes a hook for a hook-style app and a plugin entry for an opencode-style one", () => {
    const claudeSettings = join(root, "claude", "settings.json");
    expect(existsSync(claudeSettings)).toBe(true);
    expect(readFileSync(claudeSettings, "utf8")).toContain(manager.id);

    const opencodeConfig = join(root, "opencode", "opencode.json");
    expect(existsSync(opencodeConfig)).toBe(true);
    expect(readFileSync(opencodeConfig, "utf8")).toContain(manager.id);
  });
});

describe("the activity chain", () => {
  it("records the request and chains what followed to it", () => {
    const busPath = join(root, "forebay", "events", "bus.jsonl");
    expect(existsSync(busPath), "an activity log was written").toBe(true);
    const records = readFileSync(busPath, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string; payload: { action?: string; trace?: { id?: string; causedBy?: string } } });

    const requested = records.filter((r) => r.payload?.action === "plugin_install_requested");
    expect(requested.length, "one request record per install").toBe(2);

    for (const request of requested) {
      const traceId = request.payload.trace?.id;
      expect(traceId, "the request carries a trace").toBeTruthy();
      const sameTrace = records.filter((r) => r.payload?.trace?.id === traceId && r.id !== request.id);
      // Everything else in this trace must chain back to the request, directly or not.
      const ids = new Set([request.id, ...sameTrace.map((r) => r.id)]);
      for (const follower of sameTrace) {
        expect(ids.has(follower.payload.trace?.causedBy ?? ""), `${follower.id} chains inside its own trace`).toBe(true);
      }
    }
  });
});
