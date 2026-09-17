import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screensList, settingsSections, CONTRIBUTIONS_NS, resetContributionsForTests } from "./contributions.js";
import type { Contributions } from "./contributions.js";
import { writeCache, readCache, resetCacheForTests } from "../lib/cache.js";
import { hostFor, resetPluginHostsForTests } from "../lib/pluginHost.js";
import type { PluginConfigSchema, PluginHome, PluginScreen } from "../../../packages/shared/src/domain.js";

function home(id: string, label: string, overrides: Partial<PluginHome> = {}): PluginHome {
  return { id, label, dir: `/${id}`, present: true, managesPlugins: true, ...overrides };
}

const HOMES = [home("forebay", "Forebay"), home("claude", "Claude Code"), home("opencode", "OpenCode")];

let cacheDir: string;

beforeEach(() => {
  resetCacheForTests();
  resetContributionsForTests();
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  cacheDir = mkdtempSync(join(tmpdir(), "forebay-contributions-"));
  resetPluginHostsForTests();
});

// What the `screens` capability answers with, already tagged the way `realScreensOf` tags it:
// the providing plugin and the home it was read from.
function screen(plugin: string, id: string, homeId: string, extra: Partial<Omit<PluginScreen, "plugin" | "id" | "homes">> = {}): PluginScreen {
  return { plugin, id, label: id, layout: { kind: "stack" }, homes: [homeId], ...extra };
}

function schema(plugin: string): PluginConfigSchema {
  return { plugin, defaults: {}, current: {} };
}

function withSections(plugin: string, sections: NonNullable<PluginConfigSchema["sections"]>): PluginConfigSchema {
  return { plugin, defaults: {}, current: {}, sections };
}

// A plugin may declare a layout for one surface and a different one for another. The dashboard
// declares itself a surface to the host, so a layout meant for it must be the one that reaches the
// renderer: this drives the REAL reader rather than injecting `screensOf`, since resolving the
// override is that reader's job.
describe("a screen declared for more than one surface", () => {
  const spec = {
    id: "s", label: "S",
    layout: { kind: "text", text: "generic" },
    surfaces: { forebay: { kind: "text", text: "for the dashboard" }, tui: { kind: "text", text: "for the terminal" } },
  };

  function hostServing(declaration: unknown) {
    return async () => ({
      started: ["p"], quarantined: [], deployed: [],
      host: {
        capability: (id: string) => (id === "screens" ? [{ pluginId: "p", implementation: declaration }] : []),
        ledger: { entries: () => [] },
        service: () => undefined,
      },
      stop: async () => {},
    }) as never;
  }

  it("renders the layout the plugin declared for this surface", async () => {
    await hostFor("/forebay", "forebay", { start: hostServing({ screens: () => [spec] }) });
    const result = await screensList({ wait: true }, { cacheDir, homes: [home("forebay", "Forebay")], schemas: async () => [] });
    if (!result.ok) throw new Error("unreachable");
    const screens = result.data;
    expect(screens).toHaveLength(1);
    expect(screens[0].layout).toEqual({ kind: "text", text: "for the dashboard" });
  });

  // Nothing downstream should have to choose between two layouts, and the override map is answered
  // by the time a screen leaves here.
  it("carries no surface map onward", async () => {
    await hostFor("/forebay", "forebay", { start: hostServing({ screens: () => [spec] }) });
    const result = await screensList({ wait: true }, { cacheDir, homes: [home("forebay", "Forebay")], schemas: async () => [] });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data[0]).not.toHaveProperty("surfaces");
  });

  it("falls back to the generic layout when the plugin declared none for this surface", async () => {
    const only = { id: "s", label: "S", layout: { kind: "text", text: "generic" }, surfaces: { tui: { kind: "text", text: "terminal" } } };
    await hostFor("/forebay", "forebay", { start: hostServing({ screens: () => [only] }) });
    const result = await screensList({ wait: true }, { cacheDir, homes: [home("forebay", "Forebay")], schemas: async () => [] });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data[0].layout).toEqual({ kind: "text", text: "generic" });
  });
});

describe("screensList", () => {
  it("lists a screen per contributing plugin, with the homes that offer it", async () => {
    const result = await screensList({ wait: true }, {
      cacheDir,
      homes: HOMES,
      schemas: async () => [],
      screensOf: async (_dir, homeId) =>
        homeId === "claude"
          ? [screen("ledger", "ledger", homeId, { label: "Ledger" })]
          : [screen("ledger", "ledger", homeId, { label: "Ledger" }), screen("updater", "updater", homeId, { label: "Aa", order: 1 })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual([
      { plugin: "updater", id: "updater", label: "Aa", order: 1, layout: { kind: "stack" }, homes: ["forebay", "opencode"] },
      { plugin: "ledger", id: "ledger", label: "Ledger", layout: { kind: "stack" }, homes: ["forebay", "claude", "opencode"] },
    ]);
  });

  it("ignores a plugin that declares no screen", async () => {
    const result = await screensList({ wait: true }, { cacheDir, homes: HOMES, schemas: async () => [schema("quiet")], screensOf: async () => [] });
    expect(result.ok && result.data).toEqual([]);
  });

  it("carries the declared glyph through", async () => {
    const result = await screensList({ wait: true }, {
      cacheDir,
      homes: [HOMES[0]],
      schemas: async () => [],
      screensOf: async (_dir, homeId) => [screen("p", "s", homeId, { label: "P", glyph: "@" })],
    });
    expect(result.ok && result.data[0].glyph).toBe("@");
  });

  // Sorting keeps the sidebar stable across reloads: a declared order first, then label.
  it("sorts by declared order before label", async () => {
    const result = await screensList({ wait: true }, {
      cacheDir,
      homes: [HOMES[0]],
      schemas: async () => [],
      screensOf: async (_dir, homeId) => [
        screen("a", "a", homeId, { label: "Zulu", order: 1 }),
        screen("b", "b", homeId, { label: "Alpha" }),
        screen("c", "c", homeId, { label: "Bravo", order: 2 }),
      ],
    });
    expect(result.ok && result.data.map((s) => s.label)).toEqual(["Zulu", "Bravo", "Alpha"]);
  });

  it("skips a home whose screens capability cannot be read rather than failing the whole list", async () => {
    const result = await screensList({ wait: true }, {
      cacheDir,
      homes: HOMES,
      schemas: async () => [],
      screensOf: async (_dir, homeId) => {
        if (homeId === "claude") throw new Error("capability exploded");
        return [screen("p", "s", homeId, { label: "P" })];
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual([{ plugin: "p", id: "s", label: "P", layout: { kind: "stack" }, homes: ["forebay", "opencode"] }]);
  });

  it("does not probe an app home that is not installed", async () => {
    const asked: string[] = [];
    await screensList({ wait: true }, {
      cacheDir,
      homes: [home("forebay", "Forebay"), home("claude", "Claude Code", { present: false })],
      schemas: async () => [],
      screensOf: async (_dir, homeId) => { asked.push(homeId); return []; },
    });
    expect(asked).toEqual(["forebay"]);
  });

  it("takes the first home's presentation when two homes declare the same plugin differently", async () => {
    const result = await screensList({ wait: true }, {
      cacheDir,
      homes: [HOMES[0], HOMES[1]],
      schemas: async () => [],
      screensOf: async (_dir, homeId) => [screen("p", "s", homeId, homeId === "forebay" ? { label: "First" } : { label: "Second" })],
    });
    expect(result.ok && result.data).toEqual([{ plugin: "p", id: "s", label: "First", layout: { kind: "stack" }, homes: ["forebay", "claude"] }]);
  });

  it("keeps two screens of the same plugin apart, and the same id of two plugins apart", async () => {
    const result = await screensList({ wait: true }, {
      cacheDir,
      homes: [HOMES[0]],
      schemas: async () => [],
      screensOf: async (_dir, homeId) => [
        screen("a", "one", homeId, { label: "One", order: 1 }),
        screen("a", "two", homeId, { label: "Two", order: 2 }),
        screen("b", "one", homeId, { label: "B One", order: 3 }),
      ],
    });
    expect(result.ok && result.data.map((s) => `${s.plugin}:${s.id}`)).toEqual(["a:one", "a:two", "b:one"]);
  });

  it("lists a screen declared in two homes once, naming both", async () => {
    const result = await screensList({ wait: true }, {
      homes: [home("claude", "Claude Code"), home("opencode", "OpenCode")] as never,
      schemas: async () => [],
      screensOf: async (_dir, homeId) => [screen("p", "s", homeId, { label: "S" })],
      cacheDir,
    });
    expect(result.ok && result.data).toHaveLength(1);
    expect(result.ok && result.data[0].homes).toEqual(["claude", "opencode"]);
  });
});

describe("settingsSections", () => {
  const SYNC = { id: "sync", label: "Sync", order: 40, scope: "allHomes" as const, fields: ["enabled"], actions: ["sync"] };

  it("lists a section per plugin declaration, naming the plugin and the homes offering it", async () => {
    const result = await settingsSections({ wait: true }, {
      cacheDir,
      homes: [HOMES[1], HOMES[2]],
      schemas: async () => [withSections("sync-bridge", [SYNC])],
      screensOf: async () => [],
    });

    expect(result.ok && result.data).toEqual([
      { id: "sync", label: "Sync", order: 40, scope: "allHomes", plugin: "sync-bridge", homes: ["claude", "opencode"] },
    ]);
  });

  it("leaves the control lists out, since the schema already carries them", async () => {
    const result = await settingsSections({ wait: true }, { cacheDir, homes: [HOMES[0]], schemas: async () => [withSections("p", [SYNC])], screensOf: async () => [] });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data[0]).not.toHaveProperty("fields");
    expect(result.data[0]).not.toHaveProperty("actions");
  });

  it("keeps two sections of the same plugin apart, and the same id of two plugins apart", async () => {
    const result = await settingsSections({ wait: true }, {
      cacheDir,
      homes: [HOMES[0]],
      schemas: async () => [
        withSections("a", [{ id: "one", label: "One", order: 1 }, { id: "two", label: "Two", order: 2 }]),
        withSections("b", [{ id: "one", label: "B One", order: 3 }]),
      ],
      screensOf: async () => [],
    });
    expect(result.ok && result.data.map((s) => `${s.plugin}:${s.id}`)).toEqual(["a:one", "a:two", "b:one"]);
  });

  it("sorts by declared order before label, like screens", async () => {
    const result = await settingsSections({ wait: true }, {
      cacheDir,
      homes: [HOMES[0]],
      schemas: async () => [withSections("p", [{ id: "z", label: "Zulu", order: 1 }, { id: "a", label: "Alpha" }, { id: "b", label: "Bravo", order: 2 }])],
      screensOf: async () => [],
    });
    expect(result.ok && result.data.map((s) => s.label)).toEqual(["Zulu", "Bravo", "Alpha"]);
  });

  it("ignores a plugin that contributes no section", async () => {
    const result = await settingsSections({ wait: true }, { cacheDir, homes: HOMES, schemas: async () => [schema("quiet")], screensOf: async () => [] });
    expect(result.ok && result.data).toEqual([]);
  });
});

// The sidebar mounts on every launch, and probing every plugin of every home there is what
// made the sidecar miss its deadline. So the default answer is whatever was learned last
// time, and the probing happens only when a caller explicitly waits for fresh data.
describe("contributions cache", () => {
  const cached = (value: Contributions) => writeCache(CONTRIBUTIONS_NS, "contributions", value, cacheDir);

  it("answers from cache without probing anything", async () => {
    cached({
      screens: [{ plugin: "p", id: "s", label: "P", layout: { kind: "stack" }, homes: ["claude"] }],
      sections: [{ plugin: "s", id: "x", label: "X", homes: ["claude"] }],
    });
    const schemas = vi.fn(async () => []);
    const screensOf = vi.fn(async () => []);

    const screens = await screensList({}, { cacheDir, homes: HOMES, schemas, screensOf });
    const sections = await settingsSections({}, { cacheDir, homes: HOMES, schemas, screensOf });

    expect(schemas).not.toHaveBeenCalled();
    expect(screensOf).not.toHaveBeenCalled();
    expect(screens.ok && screens.data.map((s) => s.plugin)).toEqual(["p"]);
    expect(sections.ok && sections.data.map((s) => s.id)).toEqual(["x"]);
  });

  it("returns nothing on a cold cache rather than making the sidebar wait", async () => {
    const schemas = vi.fn(async () => [schema("p")]);
    const screensOf = vi.fn(async (_dir: string, homeId: string) => [screen("p", "s", homeId, { label: "P" })]);

    const result = await screensList({}, { cacheDir, homes: HOMES, schemas, screensOf });

    expect(result.ok && result.data).toEqual([]);
    expect(schemas).not.toHaveBeenCalled();
    expect(screensOf).not.toHaveBeenCalled();
  });

  it("stores what a waiting refresh learned, so the next launch paints immediately", async () => {
    await screensList({ wait: true }, {
      cacheDir,
      homes: [HOMES[0]],
      schemas: async () => [],
      screensOf: async (_dir, homeId) => [screen("p", "s", homeId, { label: "P" })],
    });

    expect(readCache<Contributions>(CONTRIBUTIONS_NS, "contributions", cacheDir)?.value).toEqual({
      screens: [{ plugin: "p", id: "s", label: "P", layout: { kind: "stack" }, homes: ["forebay"] }],
      sections: [],
    });
    const schemas = vi.fn(async () => []);
    const screensOf = vi.fn(async () => []);
    const cachedScreens = await screensList({}, { cacheDir, homes: [HOMES[0]], schemas, screensOf });
    expect(cachedScreens.ok && cachedScreens.data.map((s) => s.plugin)).toEqual(["p"]);
    expect(schemas).not.toHaveBeenCalled();
  });

  // One pass answers both, which is the reason they share a module at all.
  it("collapses concurrent refreshes into a single probe pass", async () => {
    let passes = 0;
    const schemas = async (): Promise<PluginConfigSchema[]> => {
      passes += 1;
      await new Promise((r) => setTimeout(r, 10));
      return [withSections("q", [{ id: "s", label: "S" }])];
    };
    const screensOf = async (_dir: string, homeId: string): Promise<PluginScreen[]> => [screen("p", "s", homeId, { label: "P" })];

    const [screens, sections] = await Promise.all([
      screensList({ wait: true }, { cacheDir, homes: [HOMES[0]], schemas, screensOf }),
      settingsSections({ wait: true }, { cacheDir, homes: [HOMES[0]], schemas, screensOf }),
    ]);

    expect(passes).toBe(1);
    expect(screens.ok && screens.data.map((s) => s.plugin)).toEqual(["p"]);
    expect(sections.ok && sections.data.map((s) => s.plugin)).toEqual(["q"]);
  });

  it("treats a pre-upgrade cache (the old menus/sections shape) as a cold cache rather than crashing", async () => {
    writeCache(CONTRIBUTIONS_NS, "contributions", { menus: [{ plugin: "p", id: "s", label: "P" }], sections: [] } as never, cacheDir);
    const schemas = vi.fn(async () => []);

    const result = await screensList({}, { cacheDir, homes: HOMES, schemas });

    expect(result).toEqual({ ok: true, data: [] });
    expect(schemas).not.toHaveBeenCalled();
  });

  it("drops a contribution from the cache once the plugin stops making it", async () => {
    cached({
      screens: [{ plugin: "gone", id: "g", label: "Gone", layout: { kind: "stack" }, homes: ["forebay"] }],
      sections: [{ plugin: "gone", id: "g", label: "G", homes: ["forebay"] }],
    });

    const result = await screensList({ wait: true }, { cacheDir, homes: [HOMES[0]], schemas: async () => [], screensOf: async () => [] });

    expect(result.ok && result.data).toEqual([]);
    expect(readCache<Contributions>(CONTRIBUTIONS_NS, "contributions", cacheDir)?.value).toEqual({ screens: [], sections: [] });
  });
});
