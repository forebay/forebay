import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
interface Plugin { name: string; url: string; enabled: boolean }
import type { PluginHome } from "../../../packages/shared/src/domain.js";

function makeHome(id: "cairn" | "claude" | "opencode", label: string): { dir: string; home: PluginHome } {
  const dir = mkdtempSync(join(tmpdir(), `dash-appconfig-${id}-`));
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "plugin"), { recursive: true });
  return { dir, home: { id, label, dir, present: true, managesPlugins: true } };
}

function seedPlugins(dir: string, entries: Plugin[]): void {
  writeFileSync(join(dir, "config", "plugins.json"), JSON.stringify(entries, null, 2), "utf8");
}

// The module asks the home's manager for its plugins rather than reading plugins.json itself, so
// these stand in for that answer. They read the same seed the fixtures already write, which keeps
// every case stating its plugins in one place.
function listedFromSeed(dir: string) {
  return async () => {
    try {
      return (JSON.parse(readFileSync(join(dir, "config", "plugins.json"), "utf8")) as Plugin[])
        .map((entry) => ({ id: entry.name }));
    } catch {
      return [];
    }
  };
}

function manifestOf(id: string, configDefaults: Record<string, unknown> | null, configName = id) {
  return { id, capabilities: [], permissions: [], configName, configDefaults, dataPaths: [], entryPath: null };
}


describe("appConfig sidecar module", () => {
  it("returns a schema for every plugin whose manifest declares settings, and none for one that does not", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [manifestOf("plugin-a", { logging: true }), manifestOf("plugin-b", null)],
      settingsProviders: async () => [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual([
      { plugin: "plugin-a", defaults: { logging: true }, current: {}, capabilities: [], layout: { sections: [], fields: [], actions: [] } },
    ]);
  });

  it("resolves each declaration into its contributed sections and what no section claimed", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [manifestOf("sync-bridge", { enabled: true, logging: true })],
      settingsProviders: async () => [{
        pluginId: "sync-bridge",
        implementation: {
          schema: async () => ({
            fields: [
              { key: "enabled", type: "boolean" as const },
              { key: "logging", type: "boolean" as const },
            ],
            actions: [{ id: "sync", label: "Sync now" }],
            sections: [{ id: "sync", label: "Sync", fields: ["enabled"], actions: ["sync"] }],
          }),
          run: vi.fn(),
        },
      }],
    });

    if (!result.ok) throw new Error("unreachable");
    const { layout } = result.data[0];
    expect(layout?.sections.map((s) => ({ id: s.id, plugin: s.plugin, keys: s.fields.map((f) => f.key), actions: s.actions.map((a) => a.id) }))).toEqual([
      { id: "sync", plugin: "sync-bridge", keys: ["enabled"], actions: ["sync"] },
    ]);
    expect(layout?.fields.map((f) => f.key)).toEqual(["logging"]);
    expect(layout?.actions).toEqual([]);
  });

  it("returns ok:false for an unknown home id", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("nope", { homes: [home], manifests: async () => [], settingsProviders: async () => [] });
    expect(result.ok).toBe(false);
  });

  it("takes the values from the manifest and the rest from the plugin's own live declaration", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    writeFileSync(join(dir, "config", "historian.json"), JSON.stringify({ verbose: false }), "utf8");

    const schema = vi.fn(async () => ({
      fields: [{ key: "verbose", type: "boolean" as const, label: "Verbose" }],
      actions: [{ id: "sync", label: "Sync now" }],
    }));
    const settingsProviders = vi.fn(async (homeDir: string, appId: string) => {
      expect(homeDir).toBe(dir);
      expect(appId).toBe("claude");
      return [{ pluginId: "historian", implementation: { schema, run: vi.fn() } }];
    });

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [manifestOf("historian", { verbose: true })],
      settingsProviders,
    });

    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].plugin).toBe("historian");
    expect(result.data[0].defaults).toEqual({ verbose: true });
    expect(result.data[0].current).toEqual({ verbose: false });
    expect(result.data[0].fields).toEqual([{ key: "verbose", type: "boolean", label: "Verbose" }]);
    expect(result.data[0].actions).toEqual([{ id: "sync", label: "Sync now" }]);
    expect(schema).toHaveBeenCalledTimes(1);
  });

  it("serves a plugin its manifest declares even where the home lists no entry for it", async () => {
    // configWrite already accepts a deployed plugin the home's list does not carry, so reading its
    // settings has to reach it too or a screen can write what it cannot show.
    const { dir, home } = makeHome("claude", "Claude Code");
    writeFileSync(join(dir, "config", "unlisted.json"), JSON.stringify({ interval: 30 }), "utf8");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [manifestOf("unlisted", { interval: 60 })],
      settingsProviders: async () => [],
    });

    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ plugin: "unlisted", defaults: { interval: 60 }, current: { interval: 30 } });
  });

  // A provider whose settings file predates its repository name reads config/<name>.json, which its
  // id does not spell. Reading or writing the id instead edits a file the plugin never looks at.
  it("reads and writes the settings file the manifest names, not the plugin id", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    writeFileSync(join(dir, "config", "legacy-name.json"), JSON.stringify({ interval: 30 }), "utf8");
    const declared = [manifestOf("renamed", { interval: 60 }, "legacy-name")];

    const { configSchemas, configWrite } = await import("./appConfig.js");
    const read = await configSchemas("claude", { homes: [home], manifests: async () => declared, settingsProviders: async () => [] });

    if (!read.ok) throw new Error("unreachable");
    expect(read.data[0]).toMatchObject({ plugin: "renamed", defaults: { interval: 60 }, current: { interval: 30 } });

    const written = await configWrite("claude", "renamed", "interval", 90, { homes: [home], manifests: () => declared, listPlugins: async () => [{ id: "renamed" }] });
    expect(written.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "config", "legacy-name.json"), "utf8"))).toEqual({ interval: 90 });
    expect(existsSync(join(dir, "config", "renamed.json"))).toBe(false);
  });

  it("defaults to an empty object for a capability-only plugin whose manifest declares no settings", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [],
      settingsProviders: async () => [{ pluginId: "historian", implementation: { schema: async () => ({}), run: vi.fn() } }],
    });

    if (!result.ok) throw new Error("unreachable");
    expect(result.data[0].defaults).toEqual({});
  });

  // callHostCapability never throws, so a rejecting schema() surfaces as answer.ok === false;
  // that one plugin must degrade to an empty declaration rather than sinking every other
  // plugin's schemas for the home.
  it("degrades a plugin whose schema() rejects, without sinking the rest of the list", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [manifestOf("broken", { x: 1 })],
      settingsProviders: async () => [
        { pluginId: "broken", implementation: { schema: async () => { throw new Error("boom"); }, run: vi.fn() } },
        { pluginId: "fine", implementation: { schema: async () => ({ fields: [{ key: "y", type: "boolean" as const }] }), run: vi.fn() } },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.map((s) => s.plugin)).toEqual(["broken", "fine"]);
    expect(result.data[0].defaults).toEqual({ x: 1 });
    expect(result.data[0].fields).toBeUndefined();
    expect(result.data[1].fields).toEqual([{ key: "y", type: "boolean" }]);
  });

  it("configWrite creates config/<plugin>.json when it does not exist yet", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    seedPlugins(dir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("claude", "plugin-a", "logging", false, { homes: [home], listPlugins: listedFromSeed(home.dir) });

    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(dir, "config", "plugin-a.json"), "utf8"));
    expect(onDisk).toEqual({ logging: false });
  });

  it("configWrite records the change, with the before and after values and the affected home", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    seedPlugins(dir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);
    writeFileSync(join(dir, "config", "plugin-a.json"), JSON.stringify({ logging: true }), "utf8");
    const cairnHome = mkdtempSync(join(tmpdir(), "dash-appconfig-own-"));
    vi.stubEnv("HUB_CONFIG_DIR", cairnHome);
    try {
      const { configWrite } = await import("./appConfig.js");
      const result = await configWrite("claude", "plugin-a", "logging", false, { homes: [home], listPlugins: listedFromSeed(home.dir) });
      expect(result.ok).toBe(true);

      const { readActivity } = await import("@intisy-ai/basekit");
      const { records } = readActivity([cairnHome], { topics: ["config.changed"] });
      const rec = records.find((r) => r.details.key === "logging");
      expect(rec).toBeDefined();
      expect(rec!.changes).toEqual([{ key: "logging", from: true, to: false }]);
      expect(rec!.target).toEqual({ home: dir });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("configWrite merges into an existing file, preserving unrelated keys", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    seedPlugins(dir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);
    writeFileSync(join(dir, "config", "plugin-a.json"), JSON.stringify({ logging: true, otherKey: "keep-me" }, null, 2), "utf8");

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("claude", "plugin-a", "logging", false, { homes: [home], listPlugins: listedFromSeed(home.dir) });

    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(dir, "config", "plugin-a.json"), "utf8"));
    expect(onDisk).toEqual({ logging: false, otherKey: "keep-me" });
  });

  it("configWrite returns ok:false for an unknown home id and writes nothing", async () => {
    const { dir } = makeHome("claude", "Claude Code");
    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("nope", "plugin-a", "logging", false, { homes: [] });
    expect(result.ok).toBe(false);
    expect(existsSync(join(dir, "config", "plugin-a.json"))).toBe(false);
  });

  it("configWrite rejects path traversal attempts and does not create files outside the home", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    seedPlugins(dir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("claude", "../escape", "logging", false, { homes: [home], listPlugins: listedFromSeed(home.dir), managed: async () => true });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("plugin not found");
    expect(existsSync(join(dir, "..", "escape.json"))).toBe(false);
  });

  it("configWrite's containment check rejects a plugins.json entry whose name escapes the config dir", async () => {
    // getPlugins never validates the name field, so this seeds the one case that
    // reaches the containment assertion (the plugin-list guard alone would let it through).
    const { dir, home } = makeHome("claude", "Claude Code");
    seedPlugins(dir, [{ name: "../escape", url: "https://github.com/forebay/escape", enabled: true }]);

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("claude", "../escape", "logging", false, { homes: [home], listPlugins: listedFromSeed(home.dir), managed: async () => true });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("invalid config target");
    expect(existsSync(join(dir, "escape.json"))).toBe(false);
  });

  it("configWrite rejects prototype pollution keys", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    seedPlugins(dir, [{ name: "plugin-a", url: "https://github.com/forebay/plugin-a", enabled: true }]);

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("claude", "plugin-a", "__proto__", { malicious: true }, { homes: [home], listPlugins: listedFromSeed(home.dir) });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("invalid config key");
  });

  it("configAction runs a declared action through the settings capability and returns its output", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    const run = vi.fn(async (actionId: string) => {
      expect(actionId).toBe("snapshot");
      return { ok: true, message: "ran" };
    });
    // home.dir and home.id are two distinct strings, so a positional swap in the
    // settingsProviders(homeDir, appId) call cannot pass unnoticed.
    const settingsProviders = async (homeDir: string, appId: string) => {
      expect(homeDir).toBe(dir);
      expect(appId).toBe("claude");
      return [{
        pluginId: "historian",
        implementation: { schema: async () => ({ actions: [{ id: "snapshot", label: "Snapshot" }] }), run },
      }];
    };

    const { configAction } = await import("./appConfig.js");
    const result = await configAction("claude", "historian", "snapshot", undefined, { homes: [home], settingsProviders });

    expect(result).toEqual({ ok: true, data: { stdout: "ran", stderr: "" } });
    expect(run).toHaveBeenCalledWith("snapshot");
  });

  it("hands the action what it declared, and only that", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const run = vi.fn(async () => ({ ok: true, message: "created" }));
    const settingsProviders = async () => [{
      pluginId: "historian",
      implementation: {
        schema: async () => ({ actions: [{ id: "profileCreate", label: "Create", args: [{ key: "name", type: "string" }] }] }),
        run,
      },
    }];

    const { configAction } = await import("./appConfig.js");
    // `secret` is not among the declared args, so it must not reach the plugin: a surface cannot
    // smuggle values into an action that never asked for them.
    const result = await configAction("claude", "historian", "profileCreate", { name: "work", secret: "no" }, { homes: [home], settingsProviders });

    expect(result).toEqual({ ok: true, data: { stdout: "created", stderr: "" } });
    expect(run).toHaveBeenCalledWith("profileCreate", { name: "work" });
  });

  // An action taking none must be called the way it declares itself: a plugin reading `input.name`
  // on the two-argument overload would otherwise see an empty object where it declared nothing.
  it("passes no input at all to an action that declares no args", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const run = vi.fn(async () => ({ ok: true, message: "ran" }));
    const settingsProviders = async () => [{
      pluginId: "historian",
      implementation: { schema: async () => ({ actions: [{ id: "snapshot", label: "Snapshot" }] }), run },
    }];

    const { configAction } = await import("./appConfig.js");
    await configAction("claude", "historian", "snapshot", { name: "ignored" }, { homes: [home], settingsProviders });

    expect(run).toHaveBeenCalledWith("snapshot");
  });

  it("fails the whole action rather than reporting a refusal as data", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const run = vi.fn(async () => ({ ok: false, message: "conflict with a concurrent sync" }));
    const settingsProviders = async () => [{
      pluginId: "historian",
      implementation: { schema: async () => ({ actions: [{ id: "snapshot", label: "Snapshot" }] }), run },
    }];

    const { configAction } = await import("./appConfig.js");
    const result = await configAction("claude", "historian", "snapshot", undefined, { homes: [home], settingsProviders });

    expect(result).toEqual({ ok: false, error: "conflict with a concurrent sync" });
  });

  // A plugin's action is free to throw rather than resolve {ok:false, message}: the host bounds
  // every capability call and callHostCapability never throws either, so both must land on the
  // exact same failed-Result path rather than crashing the sidecar handler.
  it("fails the action the same way when run throws instead of resolving ok:false", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const run = vi.fn(async () => { throw new Error("disk full"); });
    const settingsProviders = async () => [{
      pluginId: "historian",
      implementation: { schema: async () => ({ actions: [{ id: "snapshot", label: "Snapshot" }] }), run },
    }];

    const { configAction } = await import("./appConfig.js");
    const result = await configAction("claude", "historian", "snapshot", undefined, { homes: [home], settingsProviders });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("disk full");
  });

  // If a failing schema() let an unvalidated action id through to run, the validation would be
  // decorative: `declared` must default closed (false), not open, when the capability that is
  // supposed to answer for it cannot be reached.
  it("refuses the action rather than running it unvalidated when schema() rejects", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const run = vi.fn();
    const settingsProviders = async () => [{
      pluginId: "historian",
      implementation: { schema: async () => { throw new Error("capability wedged"); }, run },
    }];

    const { configAction } = await import("./appConfig.js");
    const result = await configAction("claude", "historian", "snapshot", undefined, { homes: [home], settingsProviders });

    expect(result).toEqual({ ok: false, error: "unknown action: snapshot" });
    expect(run).not.toHaveBeenCalled();
  });

  it("configAction rejects an action id the plugin never declared, without running it", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const run = vi.fn();
    const settingsProviders = async () => [{
      pluginId: "historian",
      implementation: { schema: async () => ({ actions: [{ id: "snapshot", label: "Snapshot" }] }), run },
    }];

    const { configAction } = await import("./appConfig.js");
    const result = await configAction("claude", "historian", "danger", undefined, { homes: [home], settingsProviders });

    expect(result).toEqual({ ok: false, error: "unknown action: danger" });
    expect(run).not.toHaveBeenCalled();
  });

  it("configAction returns an error for a plugin with no settings capability in the home", async () => {
    const { home } = makeHome("claude", "Claude Code");
    const { configAction } = await import("./appConfig.js");
    const result = await configAction("claude", "ghost", "ping", undefined, { homes: [home], settingsProviders: async () => [] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("plugin not found");
  });

  // A manifest carries VALUES only, by design: what a setting is CALLED belongs to the settings
  // capability. A plugin that ships settings but provides no capability therefore gets a screen
  // with its values and no labels, rather than no screen at all.
  it("shows a plugin's values with no field specs when it provides no settings capability", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home],
      manifests: async () => [manifestOf("plugin-a", { x: 1 })],
      settingsProviders: async () => [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data[0].defaults).toEqual({ x: 1 });
    expect(result.data[0].fields).toBeUndefined();
    expect(result.data[0].actions).toBeUndefined();
  });
});

describe("what each schema declares it provides", () => {
  it("carries the deployed manifest's capabilities, so a surface finds a plugin by what it does", async () => {
    const { dir, home } = makeHome("claude", "Claude Code");
    writeFileSync(join(dir, "plugin", "manager.js"), "// bundle placeholder", "utf8");
    writeFileSync(join(dir, "plugin", "manager.json"), JSON.stringify({ id: "manager", api: 1, entry: "dist/plugin.js", capabilities: ["plugin-management", "settings"] }));
    writeFileSync(join(dir, "plugin", "other.js"), "// bundle placeholder", "utf8");
    seedPlugins(dir, [
      { name: "manager", url: "https://github.com/forebay/manager", enabled: true },
      { name: "other", url: "https://github.com/forebay/other", enabled: true },
    ]);

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home], settingsProviders: async () => [],
      manifests: async () => [
        { id: "manager", capabilities: ["plugin-management", "settings"], permissions: [], configName: "manager", configDefaults: {}, dataPaths: [], entryPath: null },
        manifestOf("other", {}),
      ] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.find((s) => s.plugin === "manager")!.capabilities).toEqual(["plugin-management", "settings"]);
    // A plugin with no deployed manifest declares nothing, which reads as providing nothing rather
    // than as unknown: a surface selecting by capability must not match it.
    expect(result.data.find((s) => s.plugin === "other")!.capabilities).toEqual([]);
  });
});

// An engine can be installed in a home as an npm package rather than a deployed clone, and its
// settings have to be reachable there too: that is what makes the update controls per-app.
describe("engine-contributed settings", () => {
  it("reads the values that home has on disk, not another home's", async () => {
    const { dir, home } = makeHome("cairn", "Cairn");
    writeFileSync(join(dir, "plugin", "manager.js"), "// bundle placeholder", "utf8");
    seedPlugins(dir, [{ name: "manager", url: "https://github.com/forebay/manager", enabled: true }]);
    writeFileSync(join(dir, "config", "manager.json"), JSON.stringify({ auto_update_mode: "check" }), "utf8");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("cairn", { homes: [home], settingsProviders: async () => [],
      manifests: async () => [manifestOf("manager", { auto_update_mode: "update" })] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.find((s) => s.plugin === "manager")!.current.auto_update_mode).toBe("check");
  });

  // A plugin present both as a deployed clone and as an npm package is ONE row: the deployed copy
  // is the one this home runs, so its manifest is the one that answers.
  it("lists a plugin once, from the copy that home deploys", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [home], settingsProviders: async () => [],
      manifests: async () => [manifestOf("plugin-updater", { deployed: true })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const found = result.data.filter((s) => s.plugin === "plugin-updater");
    expect(found).toHaveLength(1);
    expect(found[0].defaults).toEqual({ deployed: true });
  });

  it("contributes nothing to a home that does not have the engine", async () => {
    const { home } = makeHome("claude", "Claude Code");

    const { configSchemas } = await import("./appConfig.js");
    const result = await configSchemas("claude", { homes: [{ ...home, managesPlugins: false }], manifests: async () => [], settingsProviders: async () => [] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual([]);
  });

  it("writes an engine's setting even though it is not a plugins.json entry", async () => {
    const { dir, home } = makeHome("cairn", "Cairn");
    writeFileSync(join(dir, "plugin", "plugin-updater.json"), JSON.stringify({ id: "plugin-updater", api: 1, entry: "dist/index.js", capabilities: ["plugin-management"] }));

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("cairn", "plugin-updater", "auto_update_mode", "check", { homes: [home], listPlugins: listedFromSeed(home.dir) });

    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(dir, "config", "plugin-updater.json"), "utf8"));
    expect(onDisk.auto_update_mode).toBe("check");
  });

  // The triggers are declared as dot-path fields, so a generic control edits one of them
  // without rewriting its siblings.
  it("writes one nested trigger and reads the whole object back", async () => {
    const { dir, home } = makeHome("cairn", "Cairn");
    writeFileSync(join(dir, "plugin", "plugin-updater.json"), JSON.stringify({ id: "plugin-updater", api: 1, entry: "dist/index.js", capabilities: ["plugin-management"] }));
    writeFileSync(join(dir, "config", "plugin-updater.json"), JSON.stringify({ auto_update_triggers: { loader: true, app: true, cairn: true } }), "utf8");

    writeFileSync(join(dir, "plugin", "plugin-updater.js"), "// bundle placeholder", "utf8");
    seedPlugins(dir, [{ name: "plugin-updater", url: "https://github.com/forebay/plugin-updater", enabled: true }]);

    const { configWrite, configSchemas } = await import("./appConfig.js");
    expect((await configWrite("cairn", "plugin-updater", "auto_update_triggers.app", false, { homes: [home], listPlugins: listedFromSeed(home.dir) })).ok).toBe(true);

    const result = await configSchemas("cairn", { homes: [home], settingsProviders: async () => [],
      manifests: async () => [manifestOf("plugin-updater", {})] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.find((s) => s.plugin === "plugin-updater")!.current.auto_update_triggers).toEqual({
      loader: true, app: false, cairn: true,
    });
  });

  it("still refuses a plugin that is neither installed nor an engine", async () => {
    const { home } = makeHome("cairn", "Cairn");

    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("cairn", "not-a-thing", "k", 1, { homes: [home], listPlugins: listedFromSeed(home.dir), managed: async () => true });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("plugin not found: not-a-thing");
  });
});

describe("configWrite accepts a plugin the home deployed but never listed", () => {
  it("writes for a plugin present as a sidecar and absent from the plugin list", async () => {
    const home = mkdtempSync(join(tmpdir(), "cairn-cw-"));
    mkdirSync(join(home, "plugin"), { recursive: true });
    writeFileSync(join(home, "plugin", "engine.json"), JSON.stringify({ id: "engine", api: 1, entry: "dist/index.js", capabilities: [] }));
    writeFileSync(join(home, "plugin", "engine.js"), "export default {};");
    const homes = [{ id: "cairn", label: "Cairn", dir: home, present: true, managesPlugins: true }];
    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("cairn", "engine", "flag", true, { homes });
    expect(result.ok).toBe(true);
  });

  it("refuses a plugin that is neither listed nor deployed", async () => {
    const home = mkdtempSync(join(tmpdir(), "cairn-cw-"));
    const homes = [{ id: "cairn", label: "Cairn", dir: home, present: true, managesPlugins: true }];
    const { configWrite } = await import("./appConfig.js");
    const result = await configWrite("cairn", "ghost", "flag", true, { homes, managed: async () => true });
    expect(result).toEqual({ ok: false, error: "plugin not found: ghost" });
  });
});
