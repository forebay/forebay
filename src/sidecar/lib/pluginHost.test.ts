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

  // The home a host is loaded into and the application it hosts are different things: a plugin's
  // `targets` is matched against the application, so passing the home there would compare an
  // artifact's product against whichever AI CLI it happens to sit beside.
  it("declares the application it hosts, not the home it is loaded into", async () => {
    const seen: Array<{ app: string; applications?: string[] }> = [];
    const start = async (options: { app: string; applications?: string[] }) => {
      seen.push({ app: options.app, applications: options.applications });
      return fakeLoaded(["p"], []) as never;
    };
    await hostFor("/home/claude", "claude", { start });
    await hostFor("/home/own", "forebay", { start });

    expect(seen).toEqual([
      { app: "claude", applications: ["forebay"] },
      { app: "forebay", applications: ["forebay"] },
    ]);
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

  it("stops every started host once", async () => {
    let stops = 0;
    const start = async () => ({ ...fakeLoaded(["p"], []), stop: async () => { stops += 1; } }) as never;
    await hostFor("/home/e", "app-e", { start });
    await stopAllHosts();
    await stopAllHosts();
    expect(stops).toBe(1);
  });
});
