import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { hostFor, capabilityProviders, ledgerFor, quarantinedIn, resetPluginHostsForTests, stopAllHosts } from "./pluginHost.js";

function fakeLoaded(started: string[], quarantined: Array<{ pluginId: string; detail: string; fix: string }>) {
  return {
    started,
    quarantined,
    deployed: [],
    host: {
      capability: (id: string) => (id === "screens" ? [{ pluginId: started[0], implementation: { screens: () => [] } }] : []),
      ledger: { entries: () => started.map((pluginId) => ({ pluginId, status: "active", capabilitiesDeclared: ["screens"], capabilitiesProvided: ["screens"], servicesProvided: [], servicesConsumed: [], topics: [], permissions: ["network"] })) },
      service: () => undefined,
    },
    stop: async () => {},
  };
}

describe("the per-home plugin host", () => {
  beforeEach(() => { resetPluginHostsForTests(); });

  it("starts one host per home and caches it", async () => {
    const calls: string[] = [];
    const start = async (options: { pluginDir: string }) => { calls.push(options.pluginDir); return fakeLoaded(["p"], []) as never; };
    await hostFor("/home/a", "app-a", { start });
    await hostFor("/home/a", "app-a", { start });
    await hostFor("/home/b", "app-b", { start });
    expect(calls).toEqual([join("/home/a", "plugin"), join("/home/b", "plugin")]);
  });

  it("answers empty for a home whose host failed to start, and never throws", async () => {
    const start = async () => { throw new Error("boom"); };
    expect(await hostFor("/home/c", "app-c", { start })).toBeNull();
    expect(await capabilityProviders("/home/c", "app-c", "screens", { start })).toEqual([]);
    expect(await ledgerFor("/home/c", "app-c", { start })).toEqual([]);
  });

  it("reports a quarantined plugin with its detail and fix", async () => {
    const start = async () => fakeLoaded([], [{ pluginId: "bad", detail: "activate threw", fix: "fix the error" }]) as never;
    expect(await quarantinedIn("/home/d", "app-d", { start })).toEqual([
      { pluginId: "bad", detail: "activate threw", fix: "fix the error" },
    ]);
  });

  it("builds each plugin's runtime from its manifest", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "forebay-runtime-"));
    try {
      let runtimeFor: ((manifest: unknown) => { config: { get(key: string): unknown } }) | undefined;
      const start = async (options: { runtimeFor: typeof runtimeFor }) => { runtimeFor = options.runtimeFor; return fakeLoaded(["p"], []) as never; };
      await hostFor(homeDir, "app-f", { start: start as never });
      const runtime = runtimeFor!({ id: "renamed-plugin", config: { name: "renamed", defaults: { interval: 30 } } });
      expect(runtime.config.get("interval")).toBe(30);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("stops every started host once", async () => {
    let stops = 0;
    const start = async () => ({ ...fakeLoaded(["p"], []), stop: async () => { stops += 1; } }) as never;
    await hostFor("/home/e", "app-e", { start });
    await stopAllHosts();
    await stopAllHosts();
    expect(stops).toBe(1);
  });
});
