import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { emitted, repoProvidingCapabilityMock, defaultRepoProvidingCapability } = vi.hoisted(() => {
  const defaultRepoProvidingCapability = async (_dir: string, capability: string) =>
    capability === "plugin-management"
      ? { id: "plugin-updater", npmName: "plugin-updater", url: "https://example/plugin-updater", capabilities: ["plugin-management"], description: "", sourceId: "s" }
      : null;
  return {
    emitted: [] as string[],
    repoProvidingCapabilityMock: { current: defaultRepoProvidingCapability },
    defaultRepoProvidingCapability,
  };
});
vi.mock("../activity.js", () => ({
  emitCairnAction: async (spec: { action: string }) => { emitted.push(spec.action); },
}));

// A from-scratch bootstrap installs the manager into a home before anything is deployed there, so
// the manager's identity has to come from what a marketplace DECLARES, not a real network fetch.
// Reassignable per test (see repoProvidingCapabilityMock) so a test can simulate an unreachable
// catalog without a real network dependency.
vi.mock("../lib/capabilityCatalog.js", () => ({
  repoProvidingCapability: (dir: string, capability: string) => repoProvidingCapabilityMock.current(dir, capability),
  catalogEntriesFor: async () => [],
}));

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginUpdateCache as UpdateCache } from "@intisy-ai/basekit";

interface Plugin { name: string; url: string; enabled: boolean; autoUpdate?: boolean; branch?: string }
import type { PluginHome } from "../../../packages/shared/src/domain.js";

let cairnDir: string;
let claudeDir: string;
let opencodeDir: string;
let fakeHomes: PluginHome[];

beforeEach(() => {
  cairnDir = mkdtempSync(join(tmpdir(), "dash-plugins-cairn-"));
  claudeDir = mkdtempSync(join(tmpdir(), "dash-plugins-claude-"));
  opencodeDir = mkdtempSync(join(tmpdir(), "dash-plugins-opencode-"));
  mkdirSync(join(cairnDir, "config"), { recursive: true });
  mkdirSync(join(claudeDir, "config"), { recursive: true });
  mkdirSync(join(opencodeDir, "config"), { recursive: true });
  process.env.HUB_CONFIG_DIR = cairnDir;
  fakeHomes = [
    { id: "cairn", label: "Cairn", dir: cairnDir, present: true, managesPlugins: true },
    { id: "claude", label: "Claude Code", dir: claudeDir, present: true, managesPlugins: true },
    { id: "opencode", label: "OpenCode", dir: opencodeDir, present: true, managesPlugins: false },
  ];
});

afterEach(() => {
  repoProvidingCapabilityMock.current = defaultRepoProvidingCapability;
});

function seedPlugins(dir: string, entries: Plugin[]): void {
  writeFileSync(join(dir, "config", "plugins.json"), JSON.stringify(entries, null, 2), "utf8");
}

function seedNpmPlugins(dir: string, names: string[]): void {
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ plugin: names }, null, 2), "utf8");
}

function seedCache(dir: string, cache: UpdateCache): void {
  mkdirSync(join(dir, "cache"), { recursive: true });
  writeFileSync(join(dir, "cache", "plugin-updates.json"), JSON.stringify(cache, null, 2), "utf8");
}

// Every read of a home's plugins, npm plugins and update cache goes through that home's manager
// now, so these stand in for its answers. They read the same seeds the fixtures already write,
// which keeps each test stating its plugins in one place rather than two.
function readSeed<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeSeedField(dir: string, name: string, mutate: (entry: Plugin) => void): boolean {
  const file = join(dir, "config", "plugins.json");
  const entries = readSeed<Plugin[]>(file, []);
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return false;
  mutate(entry);
  writeFileSync(file, JSON.stringify(entries, null, 2), "utf8");
  return true;
}

const fromSeed = {
  getPlugins: async (dir: string) =>
    readSeed<Plugin[]>(join(dir, "config", "plugins.json"), []).map((entry) => ({
      id: entry.name,
      url: entry.url,
      enabled: entry.enabled !== false,
      version: "",
      autoUpdate: entry.autoUpdate === undefined ? undefined : entry.autoUpdate !== false,
      channel: entry.channel,
    })),
  npmPlugins: async (dir: string) =>
    (readSeed<{ plugin?: string[] }>(join(dir, "opencode.json"), {}).plugin ?? [])
      .map((raw) => ({ name: raw.split("@")[0] || raw, version: "", installed: true })),
  readCache: async (dir: string) =>
    readSeed<UpdateCache>(join(dir, "cache", "plugin-updates.json"), { checkedAt: "", plugins: {} }),
  // The writes a manager performs on its own home, so a test can still assert WHICH home changed.
  registerPlugin: async (dir: string, name: string, url: string) => {
    const file = join(dir, "config", "plugins.json");
    const entries = readSeed<Plugin[]>(file, []);
    const existing = entries.find((entry) => entry.name === name);
    // A manager repoints an entry re-registered from a different repository, so this does too.
    if (existing) existing.url = url;
    else entries.push({ name, url, enabled: true, autoUpdate: true });
    writeFileSync(file, JSON.stringify(entries, null, 2), "utf8");
  },
  setPluginEnabled: async (dir: string, name: string, on: boolean) => writeSeedField(dir, name, (e) => { e.enabled = on; }),
  setPluginAutoUpdate: async (dir: string, name: string, on: boolean) => writeSeedField(dir, name, (e) => { e.autoUpdate = on; }),
  uninstallPlugin: async (name: string, appId: string) => {
    const dir = fakeHomes.find((home) => home.id === appId)!.dir;
    const file = join(dir, "config", "plugins.json");
    writeFileSync(file, JSON.stringify(readSeed<Plugin[]>(file, []).filter((entry) => entry.name !== name), null, 2), "utf8");
    return { ok: true };
  },
  setPluginChannel: async (dir: string, name: string, channel: PluginChannel) =>
    writeSeedField(dir, name, (e) => { if (channel === "inherit") delete e.channel; else e.channel = channel; }),
};

describe("plugins sidecar module", () => {
  it("lists plugins per home, tagging each section with its home", async () => {
    seedPlugins(cairnDir, [{ name: "claude-code-proxy", url: "https://github.com/forebay/claude-code-proxy", enabled: true }]);
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);

    const { pluginsList } = await import("./plugins.js");
    const result = await pluginsList({ ...fromSeed, homes: fakeHomes });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const sections = result.data;
    expect(sections.map((s) => s.home.id)).toEqual(["cairn", "claude", "opencode"]);
    expect(sections[0].rows.map((r) => r.name)).toContain("claude-code-proxy");
    expect(sections[1].rows.map((r) => r.name)).toContain("plugin-a");
    expect(sections[2].rows).toEqual([]);
  });

  it("skips a home entirely when it is not present, without reading its dir", async () => {
    const homesWithAbsentOpencode: PluginHome[] = [
      fakeHomes[0],
      fakeHomes[1],
      { id: "opencode", label: "OpenCode", dir: join(opencodeDir, "does-not-exist"), present: false, managesPlugins: false },
    ];
    const { pluginsList } = await import("./plugins.js");
    const result = await pluginsList({ ...fromSeed, homes: homesWithAbsentOpencode });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data[2]).toEqual({ home: homesWithAbsentOpencode[2], rows: [] });
  });

  it("merges git + npm plugins with the update-state cache for a given home", async () => {
    seedPlugins(claudeDir, [
      { name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true },
      { name: "plugin-b", url: "https://github.com/forebay/plugin-b", enabled: false },
    ]);
    seedNpmPlugins(claudeDir, ["npm-plugin-x"]);
    seedCache(claudeDir, {
      checkedAt: "2026-07-21T00:00:00.000Z",
      plugins: {
        "plugin-a": {
          kind: "git", installedVersion: null, localHead: "abc111", remoteHead: "def222",
          latestVersion: null, updateAvailable: true, updatedAt: null,
        },
        "npm-plugin-x": {
          kind: "npm", installedVersion: "1.2.3", localHead: null, remoteHead: null,
          latestVersion: "1.3.0", updateAvailable: true, updatedAt: null,
        },
      },
    });

    const { pluginsList } = await import("./plugins.js");
    const result = await pluginsList({ ...fromSeed, homes: fakeHomes });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const claudeSection = result.data.find((s) => s.home.id === "claude")!;
    const byName = new Map(claudeSection.rows.map((row) => [row.name, row]));
    expect(byName.get("plugin-a")).toEqual({
      name: "plugin-a", pluginId: "plugin-a", kind: "git", enabled: true, url: "https://github.com/forebay/plugin-a",
      installedVersion: null, updateAvailable: true, description: "", missingArtifacts: [], present: false,
    });
    expect(byName.get("plugin-b")).toEqual({
      name: "plugin-b", pluginId: "plugin-b", kind: "git", enabled: false, url: "https://github.com/forebay/plugin-b",
      installedVersion: null, updateAvailable: false, description: "", missingArtifacts: [], present: false,
    });
    expect(byName.get("npm-plugin-x")).toEqual({
      name: "npm-plugin-x", kind: "npm", enabled: true, url: undefined,
      installedVersion: "1.2.3", updateAvailable: true, description: "", present: true,
    });
  });

  // A row's pluginId is the clone's own declared identity, which can differ from the plugins.json
  // entry / clone directory name (see providers.ts's pluginIdFromClone). The developer tab joins
  // on this, not on the row's `name`.
  it("carries the clone's own declared plugin id when it differs from the entry name", async () => {
    seedPlugins(claudeDir, [{ name: "vendor-clone-dir", url: "https://github.com/forebay/vendor-clone-dir", enabled: true }]);
    mkdirSync(join(claudeDir, "repos", "vendor-clone-dir"), { recursive: true });
    writeFileSync(join(claudeDir, "repos", "vendor-clone-dir", "plugin.json"), JSON.stringify({ id: "vendor-host-id" }));

    const { pluginsList } = await import("./plugins.js");
    const result = await pluginsList({ ...fromSeed, homes: fakeHomes });
    if (!result.ok) throw new Error("unreachable");
    const row = result.data.find((s) => s.home.id === "claude")!.rows.find((r) => r.name === "vendor-clone-dir");
    expect(row?.pluginId).toBe("vendor-host-id");
  });

  // A clone whose build half-landed loads with pieces of itself missing, which is what the
  // Repair action keys off. Only a git clone has a build that can be incomplete.
  it("reports the build outputs a clone declares but does not have", async () => {
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);
    seedNpmPlugins(claudeDir, ["npm-plugin-x"]);
    const { pluginsList } = await import("./plugins.js");
    const result = await pluginsList({
      ...fromSeed,
      homes: fakeHomes,
      missingArtifacts: async (_dir, name) => (name === "plugin-a" ? ["dist/handler.js"] : []),
    });
    if (!result.ok) throw new Error("unreachable");
    const rows = result.data.find((s) => s.home.id === "claude")!.rows;
    expect(rows.find((r) => r.name === "plugin-a")?.missingArtifacts).toEqual(["dist/handler.js"]);
    expect(rows.find((r) => r.name === "npm-plugin-x")?.missingArtifacts).toBeUndefined();
  });

  it("install acts on the requested home's dir, not an ambient one", async () => {
    const scopes: string[] = [];
    const fakeUpdate = async (dir: string) => {
      scopes.push(dir);
    };

    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "plugin-b", "https://github.com/forebay/plugin-b", {
      installPlugin: fakeUpdate,
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => true,
    });

    expect(result.ok).toBe(true);
    expect(scopes[0]).toBe(fakeHomes[1].dir);
  });

  it("install syncs across apps for an app home, but never for the cairn home", async () => {
    const syncPluginsAcrossApps = vi.fn().mockResolvedValue(undefined);
    const { pluginsInstall } = await import("./plugins.js");

    await pluginsInstall("claude", "plugin-b", "https://github.com/forebay/plugin-b", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps,
      managesPlugins: () => true,
    });
    expect(syncPluginsAcrossApps).toHaveBeenCalledWith(claudeDir, "claude");

    syncPluginsAcrossApps.mockClear();
    await pluginsInstall("cairn", "plugin-c", "https://github.com/forebay/plugin-c", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps,
      managesPlugins: () => true,
    });
    expect(syncPluginsAcrossApps).not.toHaveBeenCalled();
  });

  it("setEnabled writes the target home's plugins.json, not another home's", async () => {
    seedPlugins(cairnDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);

    const { pluginsSetEnabled } = await import("./plugins.js");
    const result = await pluginsSetEnabled("claude", "plugin-a", false, { ...fromSeed, homes: fakeHomes });
    expect(result.ok).toBe(true);

    const claudeOnDisk = JSON.parse(readFileSync(join(claudeDir, "config", "plugins.json"), "utf8")) as Plugin[];
    expect(claudeOnDisk.find((p) => p.name === "plugin-a")?.enabled).toBe(false);

    const cairnOnDisk = JSON.parse(readFileSync(join(cairnDir, "config", "plugins.json"), "utf8")) as Plugin[];
    expect(cairnOnDisk.find((p) => p.name === "plugin-a")?.enabled).toBe(true);
  });

  it("setAutoUpdate writes the target home's plugins.json entry", async () => {
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true, autoUpdate: true }]);
    const { pluginsSetAutoUpdate } = await import("./plugins.js");
    const result = await pluginsSetAutoUpdate("claude", "plugin-a", false, { ...fromSeed, homes: fakeHomes });
    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(claudeDir, "config", "plugins.json"), "utf8")) as Plugin[];
    expect(onDisk.find((p) => p.name === "plugin-a")?.autoUpdate).toBe(false);
  });

  describe("pluginsSetChannel", () => {
    it("writes the channel through to the home's plugins.json", async () => {
      const calls: Array<[string, string, string]> = [];
      const { pluginsSetChannel } = await import("./plugins.js");
      const result = await pluginsSetChannel("claude", "demo", "experimental", {
        ...fromSeed,
        homes: [{ id: "claude", label: "Claude", dir: "/homes/claude", present: true, managesPlugins: true }],
        setPluginChannel: (dir, name, channel) => { calls.push([dir, name, channel]); return true; },
      });

      expect(result.ok).toBe(true);
      expect(calls).toEqual([["/homes/claude", "demo", "experimental"]]);
    });

    it("reports a plugin that is not registered in that home", async () => {
      const { pluginsSetChannel } = await import("./plugins.js");
      const result = await pluginsSetChannel("claude", "nope", "experimental", {
        ...fromSeed,
        homes: [{ id: "claude", label: "Claude", dir: "/homes/claude", present: true, managesPlugins: true }],
        setPluginChannel: () => false,
      });

      expect(result).toEqual({ ok: false, error: "plugin not found: nope" });
    });
  });

  it("setEnabled returns ok:false for an unknown plugin", async () => {
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);
    const { pluginsSetEnabled } = await import("./plugins.js");
    const result = await pluginsSetEnabled("claude", "nonexistent", true, { ...fromSeed, homes: fakeHomes });
    expect(result.ok).toBe(false);
  });

  it("downgrade looks up the plugin in the requested home and calls the injected downgrade fn, no network", async () => {
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", branch: "main", enabled: true }]);
    const downgrade = vi.fn().mockResolvedValue({ ok: true });

    const { pluginsDowngrade } = await import("./plugins.js");
    const result = await pluginsDowngrade("claude", "plugin-a", "deadbeef", { ...fromSeed, downgrade, homes: fakeHomes });

    expect(result.ok).toBe(true);
    // The manager owns the entry, so it is named rather than described: the url and branch it needs
    // are the ones it already holds, not ones this dashboard reads and hands back.
    expect(downgrade).toHaveBeenCalledWith("plugin-a", "deadbeef", "claude");
  });

  it("downgrade returns ok:false for an unknown plugin without calling downgrade", async () => {
    const downgrade = vi.fn().mockReturnValue("");
    const { pluginsDowngrade } = await import("./plugins.js");
    const result = await pluginsDowngrade("claude", "nonexistent", "deadbeef", { downgrade, homes: fakeHomes });
    expect(result.ok).toBe(false);
    expect(downgrade).not.toHaveBeenCalled();
  });

  it("downgrade returns ok:false when the injected downgrade fn reports an error", async () => {
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);
    const downgrade = vi.fn().mockReturnValue("checkout failed");
    const { pluginsDowngrade } = await import("./plugins.js");
    const result = await pluginsDowngrade("claude", "plugin-a", "deadbeef", { downgrade, homes: fakeHomes });
    expect(result.ok).toBe(false);
  });

  it("install registers a new plugin in plugins.json when none exists yet", async () => {
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "plugin-new", "https://github.com/forebay/plugin-new", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => true,
    });
    expect(result.ok).toBe(true);

    const entries = JSON.parse(readFileSync(join(claudeDir, "config", "plugins.json"), "utf8")) as Plugin[];
    expect(entries).toEqual([
      { name: "plugin-new", url: "https://github.com/forebay/plugin-new", enabled: true, autoUpdate: true },
    ]);
  });

  it("reports install phases in order through the report hook", async () => {
    const steps: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    await pluginsInstall("claude", "plugin-p", "https://github.com/forebay/plugin-p", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => true,
      report: (step) => steps.push(step),
    });
    expect(steps).toEqual(["Downloading and building", "Registering", "Syncing to other apps"]);
  });

  it("reports the app-registration phase when the manager is installed into an app home", async () => {
    const steps: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "plugin-updater", "https://github.com/forebay/plugin-updater", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => false,
      registerWithApp: () => {},
      report: (step) => steps.push(step),
    } as never);
    expect(result.ok).toBe(true);
    expect(steps).toEqual(["Downloading and building", "Registering", "Registering with the app", "Syncing to other apps"]);
  });

  it("installs the updater first rather than turning an ordinary plugin away", async () => {
    const order: string[] = [];
    const steps: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "custom-auth", "https://github.com/forebay/custom-auth", {
      installPlugin: async (_dir, name) => { order.push("install:" + name); },
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => false,
      ensureUpdater: async (homeId) => { order.push("updater:" + homeId); return { ok: true, data: undefined }; },
      report: (step) => steps.push(step),
    });
    expect(result.ok).toBe(true);
    expect(order).toEqual(["updater:claude", "install:custom-auth"]);
    expect(steps[0]).toBe("Installing the plugin manager");
  });

  it("stops at a failed bootstrap instead of installing into a home that cannot manage it", async () => {
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "custom-auth", "https://github.com/forebay/custom-auth", {
      installPlugin: async () => { throw new Error("must not run"); },
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => false,
      ensureUpdater: async () => ({ ok: false, error: "no network" }),
    });
    expect(result).toEqual({ ok: false, error: "no network" });
    expect(existsSync(join(claudeDir, "config", "plugins.json"))).toBe(false);
  });

  it("does not bootstrap when the plugin being installed is the updater itself", async () => {
    let bootstraps = 0;
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("cairn", "plugin-updater", "https://github.com/forebay/plugin-updater", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      ensureUpdater: async () => { bootstraps++; return { ok: true, data: undefined }; },
    });
    expect(result.ok).toBe(true);
    expect(bootstraps).toBe(0);
  });

  it("install does not duplicate an existing entry and preserves its other fields", async () => {
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: false, autoUpdate: false }]);

    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "plugin-a", "https://github.com/forebay/plugin-a-fork", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => true,
    });
    expect(result.ok).toBe(true);

    const entries = JSON.parse(readFileSync(join(claudeDir, "config", "plugins.json"), "utf8")) as Plugin[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ name: "plugin-a", url: "https://github.com/forebay/plugin-a-fork", enabled: false, autoUpdate: false });
  });

  it("install leaves plugins.json unwritten when the download fails", async () => {
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "plugin-fail", "https://github.com/forebay/plugin-fail", {
      installPlugin: async () => { throw new Error("clone failed"); },
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => true,
    });
    expect(result.ok).toBe(false);
    expect(existsSync(join(claudeDir, "config", "plugins.json"))).toBe(false);
  });

  it("rejects an unknown home id on install, setEnabled, and downgrade", async () => {
    const { pluginsInstall, pluginsSetEnabled, pluginsDowngrade } = await import("./plugins.js");

    const installResult = await pluginsInstall("nope" as never, "x", "y", { ...fromSeed, homes: fakeHomes });
    expect(installResult.ok).toBe(false);

    const setEnabledResult = await pluginsSetEnabled("nope" as never, "x", true, { ...fromSeed, homes: fakeHomes });
    expect(setEnabledResult.ok).toBe(false);

    const downgradeResult = await pluginsDowngrade("nope" as never, "x", "deadbeef", { ...fromSeed, homes: fakeHomes });
    expect(downgradeResult.ok).toBe(false);
  });

  it("uninstalls a git row via uninstallPlugin under the target home's scope", async () => {
    const calls: Array<[string, string]> = [];
    seedPlugins(claudeDir, [{ name: "plugin-a", url: "u", enabled: true }]);
    const { pluginsUninstall } = await import("./plugins.js");
    const result = await pluginsUninstall("claude", "plugin-a", {
      ...fromSeed,
      homes: fakeHomes,
      uninstallPlugin: async (name, appId) => { calls.push([name, appId]); return { ok: true }; },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["plugin-a", "claude"]]);
  });

  it("routes an npm row to uninstallNpmPlugin and surfaces its error string", async () => {
    const { pluginsUninstall } = await import("./plugins.js");
    const result = await pluginsUninstall("opencode", "some-npm-plugin", {
      ...fromSeed,
      homes: fakeHomes,
      npmPlugins: async () => [{ name: "some-npm-plugin", version: "1.0.0", installed: true, raw: "some-npm-plugin" }],
      uninstallNpmPlugin: async () => ({ ok: false, message: "npm exploded" }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("npm exploded");
  });

  it("disables and uninstalls any plugin now that nothing is locked, including the engine", async () => {
    seedPlugins(claudeDir, [
      { name: "wakatime-sync", url: "https://github.com/forebay/wakatime-sync", enabled: true },
      { name: "plugin-updater", url: "https://github.com/forebay/plugin-updater", enabled: true },
    ]);
    const { pluginsSetEnabled, pluginsUninstall } = await import("./plugins.js");
    expect((await pluginsSetEnabled("claude", "wakatime-sync", false, { ...fromSeed, homes: fakeHomes })).ok).toBe(true);
    expect((await pluginsSetEnabled("claude", "plugin-updater", false, { ...fromSeed, homes: fakeHomes })).ok).toBe(true);
    expect((await pluginsUninstall("claude", "plugin-updater", { ...fromSeed, homes: fakeHomes })).ok).toBe(true);
  });

  it("rejects an unknown home id on uninstall", async () => {
    const { pluginsUninstall } = await import("./plugins.js");
    const result = await pluginsUninstall("nope", "plugin-a", { ...fromSeed, homes: fakeHomes });
    expect(result.ok).toBe(false);
  });

  it("installs the manager into the cairn home by cloning only, never registering it with an app", async () => {
    const registrations: string[] = [];
    const installed: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("cairn", "plugin-updater", "https://github.com/forebay/plugin-updater", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      registerWithApp: (_dir: string, app: string) => { registrations.push(app); },
      installPlugin: async () => { installed.push("plugin-updater"); },
      syncPluginsAcrossApps: async () => {},
    } as never);
    expect(result.ok).toBe(true);
    expect(registrations).toEqual([]);
    expect(installed).toEqual(["plugin-updater"]);
  });

  it("brings the updater into Cairn's own home too, so a plugin can be installed there", async () => {
    const order: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("cairn", "some-provider", "u", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      ensureUpdater: async (homeId) => { order.push("updater:" + homeId); return { ok: true, data: undefined }; },
      installPlugin: async (_dir, name) => { order.push("install:" + name); },
      syncPluginsAcrossApps: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(order).toEqual(["updater:cairn", "install:some-provider"]);
  });

  it("new installs honor the autoUpdateDefault setting", async () => {
    const { pluginsInstall } = await import("./plugins.js");

    mkdirSync(join(cairnDir, "config"), { recursive: true });
    writeFileSync(join(cairnDir, "config", "cairn.json"), JSON.stringify({ autoUpdateDefault: false }, null, 2), "utf8");
    process.env.HUB_CONFIG_DIR = cairnDir;

    const result = await pluginsInstall("claude", "plugin-new", "https://github.com/forebay/plugin-new", {
      installPlugin: async () => {},
      ...fromSeed,
      homes: fakeHomes,
      syncPluginsAcrossApps: async () => {},
      managesPlugins: () => true,
    });
    expect(result.ok).toBe(true);

    const entries = JSON.parse(readFileSync(join(claudeDir, "config", "plugins.json"), "utf8")) as Plugin[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      name: "plugin-new",
      url: "https://github.com/forebay/plugin-new",
      enabled: true,
      autoUpdate: false,
    });
  });

  it("pluginsRemoveEverywhere uninstalls only from homes where the plugin is installed", async () => {
    seedPlugins(claudeDir, [{ name: "shared-plugin", url: "u", enabled: true }]);
    const calls: Array<[string, string]> = [];
    const { pluginsRemoveEverywhere } = await import("./plugins.js");
    const res = await pluginsRemoveEverywhere("shared-plugin", {
      ...fromSeed,
      homes: fakeHomes,
      uninstallPlugin: async (name, appId) => { calls.push([name, appId]); return { ok: true }; },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.outcomes.map((o) => o.home)).toEqual(["claude"]);
    expect(calls).toEqual([["shared-plugin", "claude"]]);
  });

  it("pluginsList surfaces a description from the deployed clone package.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-plugins-"));
    const repo = join(dir, "repos", "demo");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", description: "A demo plugin" }));
    const homes = [{ id: "claude", label: "Claude", dir, present: true, managesPlugins: true }];
    const { pluginsList } = await import("./plugins.js");
    const res = await pluginsList({ homes, getPlugins: async () => [{ id: "demo", url: "u", enabled: true, version: "" }] } as never);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const row = res.data[0].rows.find((r) => r.name === "demo");
      expect(row?.description).toBe("A demo plugin");
    }
  });
});

const HOME = { id: "claude", label: "Claude", dir: "/homes/claude", present: true, managesPlugins: true };

function cacheWith(experimentalAvailable: boolean | null) {
  return () => ({
    checkedAt: "2026-08-11T00:00:00.000Z",
    plugins: { demo: { kind: "git" as const, installedVersion: null, localHead: "a".repeat(40), remoteHead: "a".repeat(40), latestVersion: null, updateAvailable: false, experimentalAvailable, updatedAt: null } },
  });
}

describe("pluginVersions channel reporting", () => {
  // Resolution itself is plugin-updater's (tested there); here it's only pass-through, to the right home.
  it("passes the updater's answer through to the home's row", async () => {
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("demo", {
      ...fromSeed,
      homes: [HOME],
      getPlugins: async () => [{ id: "demo", url: "u", enabled: true, version: "" }],
      readCache: cacheWith(true),
      channelState: () => ({ onExperimental: true, experimentalAvailable: true }),
      exists: () => true,
      describe: () => "v1.0.0",
    });

    expect(result.ok && result.data.claude.onExperimental).toBe(true);
    expect(result.ok && result.data.claude.experimentalAvailable).toBe(true);
  });

  it("reports off and unknown when no updater answers", async () => {
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("demo", {
      ...fromSeed,
      homes: [HOME],
      getPlugins: async () => [{ id: "demo", url: "u", enabled: true, version: "" }],
      readCache: () => ({ checkedAt: "", plugins: {} }),
      channelState: () => ({ onExperimental: false, experimentalAvailable: null }),
      exists: () => true,
      describe: () => "v1.0.0",
    });

    expect(result.ok && result.data.claude.onExperimental).toBe(false);
    expect(result.ok && result.data.claude.experimentalAvailable).toBeNull();
  });

  it("asks about the plugin it is reporting, in that plugin's own home", async () => {
    const asked: Array<[string, string]> = [];
    const { pluginVersions } = await import("./plugins.js");
    await pluginVersions("demo", {
      ...fromSeed,
      homes: [HOME],
      getPlugins: async () => [{ id: "demo", url: "u", enabled: true, version: "" }],
      readCache: cacheWith(true),
      channelState: (dir, name) => { asked.push([dir, name]); return { onExperimental: false, experimentalAvailable: null }; },
      exists: () => true,
      describe: () => "v1.0.0",
    });

    expect(asked).toEqual([["/homes/claude", "demo"]]);
  });

  // A registered-but-not-cloned plugin still has a real channel answer and must not be defaulted away.
  it("asks the real channel state for a plugin that is registered but not yet cloned", async () => {
    const asked: Array<[string, string]> = [];
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("demo", {
      ...fromSeed,
      homes: [HOME],
      getPlugins: async () => [{ id: "demo", url: "u", enabled: true, version: "" }],
      readCache: () => ({ checkedAt: "", plugins: {} }),
      channelState: (dir, name) => { asked.push([dir, name]); return { onExperimental: true, experimentalAvailable: true }; },
      exists: () => false,
      describe: () => "v1.0.0",
    });

    expect(result.ok && result.data.claude).toEqual({
      kind: "git", label: null, updateState: "unknown", autoUpdate: true, onExperimental: true, experimentalAvailable: true,
    });
    expect(asked).toEqual([["/homes/claude", "demo"]]);
  });

  // The declared channel is the plugins.json entry's own field, distinct from the resolved
  // onExperimental boolean: it is what lets the renderer tell "inherit" apart from "stable".
  it("passes the entry's declared channel through, unresolved", async () => {
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("demo", {
      ...fromSeed,
      homes: [HOME],
      getPlugins: async () => [{ id: "demo", url: "u", enabled: true, version: "", channel: "inherit" as const }],
      readCache: cacheWith(true),
      channelState: () => ({ onExperimental: false, experimentalAvailable: true }),
      exists: () => true,
      describe: () => "v1.0.0",
    });

    expect(result.ok && result.data.claude.channel).toBe("inherit");
  });
});

describe("plugin versions", () => {
  it("formats git describe output into tag, ahead, and bare-sha forms", async () => {
    const { formatGitVersion } = await import("./plugins.js");
    expect(formatGitVersion("v1.2.3")).toBe("v1.2.3");
    expect(formatGitVersion("v1.2.3-5-gabc1234")).toBe("v1.2.3 +5");
    expect(formatGitVersion("abc1234")).toBe("abc1234");
    expect(formatGitVersion(null)).toBeNull();
  });

  it("reports a git plugin's version from describe and update state from the cache", async () => {
    seedCache(claudeDir, {
      checkedAt: "",
      plugins: { "plugin-a": { kind: "git", installedVersion: null, localHead: "aaa", remoteHead: "bbb", latestVersion: null, updateAvailable: true, updatedAt: null } },
    });
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("plugin-a", {
      ...fromSeed,
      homes: fakeHomes,
      describe: (dir) => (dir.includes("claude") ? "v1.2.3-5-gabc1234" : null),
      exists: (p) => p.includes("claude") && p.endsWith(join("repos", "plugin-a")),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.claude).toEqual({ kind: "git", label: "v1.2.3 +5", updateState: "behind", autoUpdate: true, checkedAt: "", onExperimental: false, experimentalAvailable: null });
    expect(result.data.cairn).toBeUndefined();
  });

  it("reports an npm plugin's installed version from the cache", async () => {
    seedCache(claudeDir, {
      checkedAt: "",
      plugins: { "npm-x": { kind: "npm", installedVersion: "2.0.1", localHead: null, remoteHead: null, latestVersion: "2.1.0", updateAvailable: true, updatedAt: null } },
    });
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("npm-x", { ...fromSeed, homes: fakeHomes, describe: () => null, exists: () => false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.claude).toEqual({ kind: "npm", label: "2.0.1", updateState: "behind", autoUpdate: true, onExperimental: false, experimentalAvailable: null });
  });

  it("falls back to the short commit sha for a git repo with no describe output", async () => {
    seedCache(claudeDir, {
      checkedAt: "",
      plugins: { "plugin-a": { kind: "git", installedVersion: null, localHead: "abcdef1234567890", remoteHead: "abcdef1234567890", latestVersion: null, updateAvailable: false, updatedAt: null } },
    });
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("plugin-a", { ...fromSeed, homes: fakeHomes, describe: () => null, exists: (p) => p.includes("claude") });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.claude).toEqual({ kind: "git", label: "abcdef1", updateState: "current", autoUpdate: true, checkedAt: "", onExperimental: false, experimentalAvailable: null });
  });

  it("reports a registered-but-not-cloned home's version as unknown, not borrowed", async () => {
    seedPlugins(opencodeDir, [{ name: "plugin-a", url: "u", enabled: true }]);
    seedCache(claudeDir, {
      checkedAt: "",
      plugins: { "plugin-a": { kind: "git", installedVersion: null, localHead: "aaa", remoteHead: "aaa", latestVersion: null, updateAvailable: false, updatedAt: null } },
    });
    const { pluginVersions } = await import("./plugins.js");
    const result = await pluginVersions("plugin-a", {
      ...fromSeed,
      homes: fakeHomes,
      describe: (dir) => (dir.includes("claude") ? "v0.2.0-5-g7c588d8" : null),
      exists: (p) => p.includes("claude") && p.endsWith(join("repos", "plugin-a")),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.claude).toEqual({ kind: "git", label: "v0.2.0 +5", updateState: "current", autoUpdate: true, checkedAt: "", onExperimental: false, experimentalAvailable: null });
    expect(result.data.opencode).toEqual({ kind: "git", label: null, updateState: "unknown", autoUpdate: true, onExperimental: false, experimentalAvailable: null });
  });

  // Listing the homes is what the plugin screen waits on before it can paint anything at all,
  // so the last answer is kept and handed back on the next launch while the real read runs.
  it("persists the listed rows so a later cached read returns them instantly", async () => {
    const { resetCacheForTests } = await import("../lib/cache.js");
    resetCacheForTests();
    const { pluginsList, pluginsListCached } = await import("./plugins.js");
    const deps = {
      ...fromSeed,
      homes: fakeHomes,
      getPlugins: async (dir: string) => (dir === claudeDir ? [{ id: "plugin-a", url: "u", enabled: true, version: "" }] : []),
      npmPlugins: async () => [],
      missingArtifacts: async () => [],
      cacheDir: cairnDir,
    } as never;

    const live = await pluginsList(deps);
    expect(live.ok).toBe(true);
    resetCacheForTests();

    const cached = await pluginsListCached({ cacheDir: cairnDir });
    expect(cached.ok).toBe(true);
    if (!cached.ok) throw new Error("unreachable");
    expect(cached.data.map((s) => s.home.id)).toEqual(["cairn", "claude", "opencode"]);
    expect(cached.data.find((s) => s.home.id === "claude")?.rows.map((r) => r.name)).toEqual(["plugin-a"]);
  });

  it("returns nothing cached before anything has been listed", async () => {
    const { resetCacheForTests } = await import("../lib/cache.js");
    resetCacheForTests();
    const { pluginsListCached } = await import("./plugins.js");
    const cached = await pluginsListCached({ cacheDir: cairnDir });
    expect(cached.ok).toBe(true);
    if (cached.ok) expect(cached.data).toEqual([]);
  });

  it("persists computed versions so a later cached read returns them instantly", async () => {
    const { resetCacheForTests } = await import("../lib/cache.js");
    resetCacheForTests();
    const { pluginVersionsAll, pluginVersionsCached } = await import("./plugins.js");
    const deps = {
      ...fromSeed,
      homes: fakeHomes,
      getPlugins: async (dir: string) => (dir === claudeDir ? [{ id: "plugin-a", url: "u", enabled: true, version: "" }] : []),
      npmPlugins: async () => [],
      describe: () => "v3.1.0",
      exists: () => true,
      cacheDir: cairnDir,
    };
    await pluginVersionsAll(deps);
    resetCacheForTests();
    const cached = await pluginVersionsCached({ cacheDir: cairnDir });
    expect(cached.ok).toBe(true);
    if (!cached.ok) throw new Error("unreachable");
    // No cache entry was seeded, so nothing is known about this home's update state. It used
    // to report "no update available", which is how a never-checked home looked up to date.
    expect(cached.data["plugin-a"].claude).toEqual({ kind: "git", label: "v3.1.0", updateState: "unknown", autoUpdate: true, checkedAt: "", onExperimental: false, experimentalAvailable: null });
  });

  it("collects versions for every installed plugin across homes in one pass", async () => {
    seedCache(claudeDir, {
      checkedAt: "",
      plugins: { "plugin-a": { kind: "git", installedVersion: null, localHead: "aaa", remoteHead: "bbb", latestVersion: null, updateAvailable: true, updatedAt: null } },
    });
    const { pluginVersionsAll } = await import("./plugins.js");
    const result = await pluginVersionsAll({
      ...fromSeed,
      homes: fakeHomes,
      getPlugins: async (dir: string) => (dir === claudeDir ? [{ id: "plugin-a", url: "u", enabled: true, version: "" }] : []),
      npmPlugins: async () => [],
      describe: () => "v2.0.0",
      exists: () => true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data["plugin-a"].claude).toEqual({ kind: "git", label: "v2.0.0", updateState: "behind", autoUpdate: true, checkedAt: "", onExperimental: false, experimentalAvailable: null });
  });
});

describe("pluginsInstall for the plugin manager", () => {
  it("clones, registers, then registers with the app, in that order", async () => {
    const order: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const res = await pluginsInstall("claude", "plugin-updater", "https://example/plugin-updater", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      installPlugin: async () => { order.push("clone"); },
      registerWithApp: (dir: string, app: string) => { order.push(`register-with-app:${dir}:${app}`); },
      syncPluginsAcrossApps: async () => { order.push("sync"); },
    } as never);
    expect(res.ok).toBe(true);
    expect(order).toEqual(["clone", `register-with-app:${claudeDir}:claude`, "sync"]);
    expect(JSON.parse(readFileSync(join(claudeDir, "config", "plugins.json"), "utf8"))
      .some((p: Plugin) => p.name === "plugin-updater")).toBe(true);
  });

  it("does not register with an app for Cairn's own home", async () => {
    const calls: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const res = await pluginsInstall("cairn", "plugin-updater", "https://example/plugin-updater", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      installPlugin: async () => {},
      registerWithApp: (dir: string, app: string) => { calls.push(`${dir}:${app}`); },
    } as never);
    expect(res.ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it("fails the install when app registration fails", async () => {
    const { pluginsInstall } = await import("./plugins.js");
    const res = await pluginsInstall("claude", "plugin-updater", "https://example/plugin-updater", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      installPlugin: async () => {},
      registerWithApp: () => { throw new Error("settings.json is read-only"); },
      syncPluginsAcrossApps: async () => {},
    } as never);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("read-only");
  });

  it("never bootstraps a manager in order to install the manager", async () => {
    const ensureUpdater = vi.fn(async () => ({ ok: true, data: undefined }));
    const { pluginsInstall } = await import("./plugins.js");
    await pluginsInstall("claude", "plugin-updater", "https://example/plugin-updater", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      installPlugin: async () => {},
      registerWithApp: () => {},
      syncPluginsAcrossApps: async () => {},
      ensureUpdater,
    } as never);
    expect(ensureUpdater).not.toHaveBeenCalled();
  });
});

describe("pluginsInstall when the marketplace catalog is unreachable", () => {
  it("still recognizes an already-deployed manager as the manager, via its manifest", async () => {
    mkdirSync(join(cairnDir, "plugin"), { recursive: true });
    writeFileSync(join(cairnDir, "plugin", "plugin-updater.json"), JSON.stringify({ id: "plugin-updater", api: 1, entry: "dist/index.js", capabilities: ["plugin-management"] }));
    repoProvidingCapabilityMock.current = async () => { throw new Error("catalog unreachable"); };

    const ensureUpdater = vi.fn(async () => ({ ok: true, data: undefined }));
    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("cairn", "plugin-updater", "https://example/plugin-updater", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => false,
      installPlugin: async () => {},
      ensureUpdater,
    } as never);

    expect(result.ok).toBe(true);
    expect(ensureUpdater).not.toHaveBeenCalled();
  });

  it("does not abort an ordinary plugin install; it simply proceeds as a non-manager install", async () => {
    repoProvidingCapabilityMock.current = async () => { throw new Error("catalog unreachable"); };

    const { pluginsInstall } = await import("./plugins.js");
    const result = await pluginsInstall("claude", "custom-auth", "https://github.com/forebay/custom-auth", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => true,
      installPlugin: async () => {},
      syncPluginsAcrossApps: async () => {},
    });

    expect(result.ok).toBe(true);
  });
});

describe("the record that starts an install", () => {
  it("is emitted before any install work", async () => {
    emitted.length = 0;
    const order: string[] = [];
    const { pluginsInstall } = await import("./plugins.js");
    const res = await pluginsInstall("claude", "wakatime-sync", "https://example/wakatime-sync", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => true,
      installPlugin: async () => { order.push("clone"); },
      syncPluginsAcrossApps: async () => {},
    } as never);
    expect(res.ok).toBe(true);
    expect(emitted).toContain("plugin_install_requested");
    expect(order).toEqual(["clone"]);
  });

  it("is emitted even when the install then fails", async () => {
    emitted.length = 0;
    const { pluginsInstall } = await import("./plugins.js");
    const res = await pluginsInstall("claude", "wakatime-sync", "https://example/wakatime-sync", {
      ...fromSeed,
      homes: fakeHomes,
      managesPlugins: () => true,
      installPlugin: async () => { throw new Error("clone refused"); },
      syncPluginsAcrossApps: async () => {},
    } as never);
    expect(res.ok).toBe(false);
    expect(emitted[0]).toBe("plugin_install_requested");
  });
});
