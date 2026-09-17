import { describe, it, expect } from "vitest";
import type { PluginHome } from "../../../packages/shared/src/domain.js";

const claudeDir = "/tmp/updates-claude";
const forebayDir = "/tmp/updates-forebay";

function home(id: string, dir: string, present = true): PluginHome {
  return { id, label: id, dir, present, managesPlugins: true } as PluginHome;
}

const fakeHomes: PluginHome[] = [home("forebay", forebayDir), home("claude", claudeDir)];

describe("updates sidecar module", () => {
  it("checks the home the caller named and reports the plugins flagged as available", async () => {
    const { updatesCheck } = await import("./updates.js");
    const seen: Array<[string, string]> = [];
    const result = await updatesCheck("claude", {
      homes: async () => fakeHomes,
      checkUpdates: async (dir, appId) => {
        seen.push([dir, appId]);
        return {
          checkedAt: "2026-08-05T00:00:00.000Z",
          plugins: { "plugin-a": { updateAvailable: true }, "plugin-b": { updateAvailable: false } },
        };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.available).toEqual(["plugin-a"]);
    expect(result.data.checkedAt).toBe("2026-08-05T00:00:00.000Z");
    expect(seen).toEqual([[claudeDir, "claude"]]);
  });

  it("reports nothing available for a home with no manager, rather than failing", async () => {
    const { updatesCheck } = await import("./updates.js");
    const result = await updatesCheck("claude", { homes: async () => fakeHomes, checkUpdates: async () => null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ checkedAt: "", available: [] });
  });

  it("updates one plugin in the named home and passes the name through", async () => {
    const { updatesOne } = await import("./updates.js");
    const calls: { dir: string; name: string; appId: string }[] = [];
    const result = await updatesOne("claude", "plugin-a", {
      homes: async () => fakeHomes,
      updateOne: async (dir, name, appId) => {
        calls.push({ dir, name, appId });
        return { ok: true, message: "updated plugin-a" };
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ dir: claudeDir, name: "plugin-a", appId: "claude" }]);
  });

  // The manager answers a refusal as data, so the envelope has to turn it into a failure or the
  // caller shows a success for an update that never happened.
  it("surfaces a refused update as a failure carrying the manager's own line", async () => {
    const { updatesOne } = await import("./updates.js");
    const result = await updatesOne("claude", "plugin-a", {
      homes: async () => fakeHomes,
      updateOne: async () => ({ ok: false, message: "plugin-a failed to update" }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("plugin-a failed to update");
  });

  it("fails an update in a home with nothing managing its plugins", async () => {
    const { updatesAll } = await import("./updates.js");
    const result = await updatesAll("forebay", { homes: async () => fakeHomes, updateAll: async () => null });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("nothing manages the plugins of forebay");
  });

  it("updates everything in the named home", async () => {
    const { updatesAll } = await import("./updates.js");
    const seen: Array<[string, string]> = [];
    const result = await updatesAll("forebay", {
      homes: async () => fakeHomes,
      updateAll: async (dir, appId) => { seen.push([dir, appId]); return { ok: true }; },
    });

    expect(result.ok).toBe(true);
    expect(seen).toEqual([[forebayDir, "forebay"]]);
  });

  it("refuses a home it does not know, without asking any manager", async () => {
    const { updatesAll } = await import("./updates.js");
    let called = false;
    const result = await updatesAll("nope", {
      homes: async () => fakeHomes,
      updateAll: async () => { called = true; return { ok: true }; },
    });

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("reports a throwing manager as a failed result rather than throwing", async () => {
    const { updatesCheck } = await import("./updates.js");
    const result = await updatesCheck("claude", {
      homes: async () => fakeHomes,
      checkUpdates: async () => { throw new Error("ls-remote failed"); },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("ls-remote failed");
  });
});
