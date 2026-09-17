import { describe, it, expect, vi } from "vitest";
import { pluginsData, pluginsRemoveData } from "./pluginData.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";

function home(id: string, label: string, overrides: Partial<PluginHome> = {}): PluginHome {
  return { id, label, dir: `/${id}`, present: true, managesPlugins: true, ...overrides };
}

const HOMES = [home("forebay", "Forebay"), home("claude", "Claude Code"), home("opencode", "OpenCode", { present: false })];

describe("pluginsData", () => {
  it("reports what the plugin left in each home, leaving out the homes holding nothing", async () => {
    const result = await pluginsData("wakatime-sync", {
      homes: HOMES,
      declaredPaths: () => [],
      read: async (dir) => (dir === "/claude" ? [{ path: "config/wakatime-sync.json", bytes: 12 }] : []),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.map((entry) => entry.home.id)).toEqual(["claude"]);
    expect(result.data[0].entries).toEqual([{ path: "config/wakatime-sync.json", bytes: 12 }]);
  });

  it("does not look in an app home that is not installed", async () => {
    const asked: string[] = [];
    await pluginsData("p", {
      homes: HOMES,
      declaredPaths: () => [],
      read: async (dir) => { asked.push(dir); return []; },
    });
    expect(asked).toEqual(["/forebay", "/claude"]);
  });

  // The declaration lives in the deployed sidecar, so it has to be read while the plugin is
  // still installed: that is why the paths are gathered before an uninstall, not after.
  it("passes the plugin's declared paths through to the reader", async () => {
    const read = vi.fn(async () => []);
    await pluginsData("sync-bridge", {
      homes: [HOMES[0]],
      declaredPaths: () => ["state/mirror"],
      read,
    });
    expect(read).toHaveBeenCalledWith("/forebay", "sync-bridge", ["state/mirror"], "forebay");
  });
});

describe("pluginsRemoveData", () => {
  it("deletes the given paths in the named home", async () => {
    const remove = vi.fn(async () => ["config/p.json"]);
    const result = await pluginsRemoveData("claude", ["config/p.json"], { homes: HOMES, remove });

    expect(remove).toHaveBeenCalledWith("/claude", ["config/p.json"], "claude");
    expect(result.ok && result.data).toEqual(["config/p.json"]);
  });

  it("refuses a home it does not know rather than guessing one", async () => {
    const remove = vi.fn(async () => []);
    const result = await pluginsRemoveData("nowhere", ["config/p.json"], { homes: HOMES, remove });

    expect(result.ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
