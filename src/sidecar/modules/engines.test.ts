import { describe, it, expect } from "vitest";
import { enginesList, ensureEngineIn, pluginOwningCapability } from "./engines.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";

const homes: PluginHome[] = [
  { id: "forebay", label: "Forebay", dir: "/homes/forebay", present: true, managesPlugins: true },
  { id: "app-a", label: "App A", dir: "/homes/a", present: true, managesPlugins: true },
];

const catalog = [
  { id: "manager", npmName: "manager", url: "https://example/manager", capabilities: ["plugin-management"], description: "", sourceId: "s" },
  { id: "historian", npmName: "historian", url: "https://example/historian", capabilities: ["config-history", "screens"], description: "", sourceId: "s" },
];

describe("enginesList", () => {
  it("lists one row per capability the catalog offers, with each home's state", async () => {
    const result = await enginesList({
      homes,
      catalog: async () => catalog,
      ownerIn: (dir, capability) => (dir === "/homes/a" && capability === "config-history" ? "historian" : null),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const history = result.data.find((row) => row.capability === "config-history");
    expect(history?.id).toBe("historian");
    expect(history?.url).toBe("https://example/historian");
    expect(history?.homes["app-a"]).toEqual({ installed: true, enabled: true });
    expect(history?.homes.forebay).toEqual({ installed: false, enabled: false });
  });

  it("enumerates no capability of its own: an unknown one from the catalog is listed too", async () => {
    const result = await enginesList({
      homes,
      catalog: async () => [{ id: "future", npmName: "future", url: "https://example/future", capabilities: ["not-minted-yet"], description: "", sourceId: "s" }],
      ownerIn: () => null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((row) => row.capability)).toEqual(["not-minted-yet"]);
  });

  it("answers an empty list when no source offers anything", async () => {
    const result = await enginesList({ homes, catalog: async () => [], ownerIn: () => null });
    expect(result).toEqual({ ok: true, data: [] });
  });

  // A fixture that ignores its homeDir argument cannot distinguish reading every home from
  // reading only one, since every home would then answer with the same catalog either way.
  it("unions catalog entries across homes rather than reading only one", async () => {
    const perHome: Record<string, typeof catalog> = {
      "/homes/forebay": [catalog[0]],
      "/homes/a": [catalog[1]],
    };
    const result = await enginesList({
      homes,
      catalog: async (homeDir) => perHome[homeDir] ?? [],
      ownerIn: () => null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((row) => row.capability).sort()).toEqual(["config-history", "plugin-management", "screens"]);
  });
});

describe("ensureEngineIn", () => {
  it("installs the catalog's repository for a capability the home lacks", async () => {
    const installs: Array<[string, string, string]> = [];
    const result = await ensureEngineIn("plugin-management", "app-a", {
      homes,
      catalog: async () => catalog,
      ownerIn: () => null,
      pluginsInstall: async (homeId, name, url) => { installs.push([homeId, name, url]); return { ok: true, data: undefined }; },
    });
    expect(result.ok).toBe(true);
    expect(installs).toEqual([["app-a", "manager", "https://example/manager"]]);
  });

  it("does nothing when the home already has a plugin declaring the capability", async () => {
    const installs: unknown[] = [];
    const result = await ensureEngineIn("plugin-management", "app-a", {
      homes,
      catalog: async () => catalog,
      ownerIn: () => "manager",
      pluginsInstall: async () => { installs.push(1); return { ok: true, data: undefined }; },
    });
    expect(result.ok).toBe(true);
    expect(installs).toEqual([]);
  });

  it("fails with a message naming the capability when no source offers it", async () => {
    const result = await ensureEngineIn("nothing-offers-this", "app-a", {
      homes,
      catalog: async () => catalog,
      ownerIn: () => null,
      pluginsInstall: async () => ({ ok: true, data: undefined }),
    });
    expect(result).toEqual({ ok: false, error: "no marketplace source offers a plugin providing nothing-offers-this" });
  });
});

describe("pluginOwningCapability", () => {
  it("names nothing for a home with no plugin declaring the capability", () => {
    expect(pluginOwningCapability("screens", "/homes/absent")).toBeNull();
  });
});
