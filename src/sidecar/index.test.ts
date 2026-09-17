import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, registerHandler } from "./index.js";
import { ok } from "./result.js";
import { currentCause } from "@intisy-ai/basekit";

describe("dispatch", () => {
  it("resolves to {ok:false} when the handler throws", async () => {
    registerHandler("throws", async () => {
      throw new Error("boom");
    });
    expect(await dispatch("throws", [])).toEqual({ ok: false, error: "boom" });
  });

  it("resolves to the handler's own Result without double-nesting", async () => {
    registerHandler("succeeds", async (x) => ok(x));
    expect(await dispatch("succeeds", [5])).toEqual({ ok: true, data: 5 });
  });

  async function causeFor(channel: string): Promise<{ kind: string; surface?: string }> {
    let seen: { kind: string; surface?: string } | null = null;
    registerHandler(channel, async () => { seen = currentCause(); return ok(null); });
    expect(await dispatch(channel, [])).toEqual({ ok: true, data: null });
    expect(seen).not.toBeNull();
    return seen as unknown as { kind: string; surface?: string };
  }

  it("runs a state-changing handler inside a user cause naming its channel", async () => {
    const cause = await causeFor("probes:setEnabled");
    expect(cause.kind).toBe("user");
    expect(cause.surface).toBe("probes:setEnabled");
  });

  it("does not claim a user action for a read the dashboard polls", async () => {
    expect((await causeFor("probes:list")).kind).toBe("watch");
    expect((await causeFor("probes:read")).kind).toBe("watch");
    expect((await causeFor("probes:status")).kind).toBe("watch");
  });

  it("treats an unrecognized channel shape as a change, not as a read", async () => {
    expect((await causeFor("probes-cause")).kind).toBe("user");
  });
});

describe("shutdown", () => {
  it("stops every plugin host and acknowledges", async () => {
    const { hostFor, resetPluginHostsForTests } = await import("./lib/pluginHost.js");
    resetPluginHostsForTests();
    let stopped = false;
    await hostFor("/tmp/forebay-shutdown-home", "forebay", {
      start: async () => ({
        started: [],
        quarantined: [],
        deployed: [],
        host: { capability: () => [], ledger: { entries: () => [] }, service: () => undefined },
        stop: async () => { stopped = true; },
      }) as never,
    });

    expect(await dispatch("shutdown", [])).toEqual({ ok: true, data: true });
    expect(stopped).toBe(true);
  });
});

describe("activity home", () => {
  let tempDir: string;
  let savedHubConfigDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "forebay-activity-home-"));
    savedHubConfigDir = process.env.HUB_CONFIG_DIR;
    process.env.HUB_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    if (savedHubConfigDir === undefined) delete process.env.HUB_CONFIG_DIR;
    else process.env.HUB_CONFIG_DIR = savedHubConfigDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  // The home an event lands under and the home the Activity view scans for "forebay"
  // must be the exact same value. pluginHomes leaves forebayDir at its default here,
  // so it exercises the real derivation on both sides instead of an injected stand-in.
  // HUB_APPS_FILE is deliberately left unset: the supervisor only forces HUB_CONFIG_DIR,
  // and it's that gap between the two env vars that let the two derivations drift apart.
  it("stamps the same home pluginHomes reports for forebay's own entry", async () => {
    vi.resetModules();
    await import("./index.js");
    const { getActivityContext } = await import("@intisy-ai/basekit");
    const { pluginHomes } = await import("./lib/pluginHomes.js");

    const homes = await pluginHomes({ detect: async () => ({ ok: true, data: {} }), managesPlugins: () => false });
    const forebayHome = homes.find((h) => h.id === "forebay");
    if (!forebayHome) throw new Error("unreachable");

    expect(getActivityContext().home).toBe(forebayHome.dir);
  });
});

describe("background updates on launch", () => {
  it("starts a run for its own home without blocking startup", async () => {
    const { startBackgroundUpdates } = await import("./index.js");
    const calls: { dir: string; trigger: string }[] = [];

    const returned = startBackgroundUpdates({
      home: "/tmp/forebay-home",
      runUpdates: async (dir: string, trigger: string) => { calls.push({ dir, trigger }); return {}; },
    });

    // Fire and forget: boot never awaits the run. The capability is resolved against one home, so
    // there is no queue to serialize ambient-home mutation through and the run starts at once.
    expect(returned).toBeUndefined();
    for (let i = 0; i < 50 && calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([{ dir: "/tmp/forebay-home", trigger: "dashboard" }]);
  });

  it("survives an engine that throws, because the dashboard still has to open", async () => {
    const { startBackgroundUpdates } = await import("./index.js");
    expect(() => startBackgroundUpdates({
      home: "/tmp/forebay-home",
      runUpdates: async () => { throw new Error("boom"); },
    })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
