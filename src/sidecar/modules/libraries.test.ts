import { describe, it, expect, vi } from "vitest";
import { librariesList } from "./libraries.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";

function home(id: string, dir: string): PluginHome {
  return { id, label: id, dir, present: true, managesPlugins: true };
}

const HOMES = [home("forebay", "/forebay"), home("claude", "/claude")];

describe("librariesList", () => {
  it("reports each home's shared store and per-plugin dependencies", async () => {
    const read = vi.fn(async (dir: string) => ({
      shared: [{ specifier: "@intisy-ai/basekit", version: dir === "/forebay" ? "2.1.0" : "2.0.0", usedBy: ["stub-auth"] }],
      plugins: [{ plugin: "stub-auth", dependencies: [{ specifier: "undici", version: "6.19.2", usedBy: [] }] }],
    }));

    const result = await librariesList({ homes: async () => HOMES, read });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((h) => h.home.id)).toEqual(["forebay", "claude"]);
    expect(result.data[0].shared[0]).toMatchObject({ specifier: "@intisy-ai/basekit", version: "2.1.0" });
    expect(result.data[1].shared[0]).toMatchObject({ version: "2.0.0" });
    expect(result.data[0].plugins[0].plugin).toBe("stub-auth");
  });

  it("reads every home rather than stopping at the first", async () => {
    const read = vi.fn(async () => ({ shared: [], plugins: [] }));
    await librariesList({ homes: async () => HOMES, read });
    expect(read.mock.calls.map((c) => c[0])).toEqual(["/forebay", "/claude"]);
  });

  // Without plugin-updater there is no store to read and nothing that could fill one, so an
  // empty reading is the truth here, not a failure to surface.
  it("reports empty homes when the engine cannot be loaded", async () => {
    const result = await librariesList({ homes: async () => HOMES, read: async () => ({ shared: [], plugins: [] }) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([
      { home: HOMES[0], shared: [], plugins: [] },
      { home: HOMES[1], shared: [], plugins: [] },
    ]);
  });

  it("errors when the homes cannot be listed at all", async () => {
    const result = await librariesList({ homes: async () => { throw new Error("no registry"); } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("no registry");
  });
});
