// The dashboard's records live in its own home and name the home they affected, so a
// reader can tell "changed from here" from "changed here".
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHome } from "../../packages/shared/src/domain.js";

function home(id: "forebay" | "claude", dir: string): PluginHome {
  return { id, label: id, dir, present: true, managesPlugins: true };
}

function homes(): { forebayHome: string; appHome: string; list: PluginHome[] } {
  const forebayHome = mkdtempSync(join(tmpdir(), "dash-activity-own-"));
  const appHome = mkdtempSync(join(tmpdir(), "dash-activity-app-"));
  mkdirSync(join(appHome, "config"), { recursive: true });
  return { forebayHome, appHome, list: [home("forebay", forebayHome), home("claude", appHome)] };
}

describe("dashboard activity", () => {
  it("records an action against the home it affected, not the home it ran in", async () => {
    const { forebayHome, appHome, list } = homes();
    vi.stubEnv("HUB_CONFIG_DIR", forebayHome);
    try {
      const { emitForebayAction } = await import("./activity.js");
      await emitForebayAction({
        action: "plugin_enabled",
        subject: { kind: "plugin", id: "plugin-a" },
        homeId: "claude",
        details: { message: "Enabled plugin-a" },
      }, list);

      const { readActivity } = await import("@intisy-ai/basekit");
      const { records } = readActivity([forebayHome]);
      expect(records).toHaveLength(1);
      expect(records[0].source).toBe("forebay");
      expect(records[0].action).toBe("plugin_enabled");
      expect(records[0].actor).toBe("user");
      expect(records[0].outcome).toBe("ok");
      expect(records[0].target).toEqual({ home: appHome });
      expect(readActivity([appHome]).records).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      rmSync(forebayHome, { recursive: true, force: true });
      rmSync(appHome, { recursive: true, force: true });
    }
  });

  it("omits the target when the action affected the dashboard's own home", async () => {
    const { forebayHome, appHome, list } = homes();
    vi.stubEnv("HUB_CONFIG_DIR", forebayHome);
    try {
      const { emitForebayAction } = await import("./activity.js");
      await emitForebayAction({ action: "plugin_enabled", subject: { kind: "plugin", id: "x" }, homeId: "forebay" }, list);

      const { readActivity } = await import("@intisy-ai/basekit");
      const [rec] = readActivity([forebayHome]).records;
      expect(rec.target).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(forebayHome, { recursive: true, force: true });
      rmSync(appHome, { recursive: true, force: true });
    }
  });

  it("records nothing and throws nothing when the affected home cannot be resolved", async () => {
    const { forebayHome, appHome, list } = homes();
    vi.stubEnv("HUB_CONFIG_DIR", forebayHome);
    try {
      const { emitForebayAction } = await import("./activity.js");
      await expect(emitForebayAction({ action: "plugin_enabled", subject: { kind: "plugin", id: "x" }, homeId: "nope" }, list))
        .resolves.toBeUndefined();

      const { readActivity } = await import("@intisy-ai/basekit");
      const [rec] = readActivity([forebayHome]).records;
      expect(rec.target).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(forebayHome, { recursive: true, force: true });
      rmSync(appHome, { recursive: true, force: true });
    }
  });
});
