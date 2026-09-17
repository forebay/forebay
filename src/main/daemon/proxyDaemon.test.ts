import { describe, it, expect, vi, afterEach } from "vitest";
import { createProxyServer, makeDynamicResolver } from "@intisy-ai/basekit/proxy";
import type { RoutingProfile } from "@intisy-ai/basekit/proxy";
import type { StartedLoaderProxy } from "@intisy-ai/basekit/loader/proxy-runner.js";
import type { LoadedProxyDef } from "../../sidecar/lib/proxyPlugins.js";
import { buildStartOptions, onStatusChange, resolveProxyProfile, start, status, stop } from "./proxyDaemon.js";

describe("buildStartOptions", () => {
  it("assembles the startLoaderProxy options for the given configDir and profile", () => {
    const profile = { marker: 1 } as unknown as RoutingProfile;
    const options = buildStartOptions("/some/dir", profile);
    expect(options.configDir).toBe("/some/dir");
    expect(options.port).toBe(34567);
    expect(options.createProxyServer).toBe(createProxyServer);
    expect(options.makeDynamicResolver).toBe(makeDynamicResolver);
    expect(options.profile).toBe(profile);
  });
});

describe("resolveProxyProfile", () => {
  it("throws a generic install hint when no proxy plugin is installed", async () => {
    await expect(resolveProxyProfile({ defs: async () => [], unresolved: async () => [] })).rejects.toThrow("no proxy plugin installed");
  });

  it("returns the first installed def's profile, whatever app it targets", async () => {
    const profile = { marker: 1 } as unknown as RoutingProfile;
    const defs: LoadedProxyDef[] = [{ app: "some-app", label: "S", profile: () => profile }];
    await expect(resolveProxyProfile({ defs: async () => defs })).resolves.toBe(profile);
  });

  it("names the plugin and points at a reinstall when one is installed but its manifest cannot be read", async () => {
    await expect(resolveProxyProfile({ defs: async () => [], unresolved: async () => ["gateway"] }))
      .rejects.toThrow("gateway is installed but the version in this home declares no plugin manifest");
  });
});

describe("onStatusChange", () => {
  it("pushes running on start and stopped on stop", async () => {
    const seen: boolean[] = [];
    const off = onStatusChange((s) => seen.push(s.running));
    const fakeHandle = { server: { close: async () => {} } } as unknown as StartedLoaderProxy;
    await start(async () => fakeHandle, async () => ({ marker: 1 } as unknown as RoutingProfile));
    await stop();
    off();
    expect(seen).toEqual([true, false]);
  });
});

describe("status", () => {
  afterEach(async () => {
    await stop();
    vi.unstubAllGlobals();
  });

  it("reports not running when there is no Forebay daemon handle, even if a probe would find the port held by something else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const result = await status();
    expect(result.running).toBe(false);
  });

  it("reports running once the daemon's own handle is set, with no probe involved", async () => {
    const fakeHandle = { server: { close: async () => {} } } as unknown as StartedLoaderProxy;
    await start(async () => fakeHandle, async () => ({ marker: 1 } as unknown as RoutingProfile));
    const result = await status();
    expect(result.running).toBe(true);
  });
});

const fakeProfile = async (): Promise<RoutingProfile> => ({ marker: 1 }) as unknown as RoutingProfile;

describe("start", () => {
  it("concurrent calls invoke the injected starter only once", async () => {
    let calls = 0;
    const fakeHandle = { server: { close: async () => {} } } as unknown as StartedLoaderProxy;
    const starter = async (): Promise<StartedLoaderProxy> => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fakeHandle;
    };

    await Promise.all([start(starter, fakeProfile), start(starter, fakeProfile)]);

    expect(calls).toBe(1);
    await stop();
  });

  it("clears the in-flight promise after a rejected starter, so a later start retries", async () => {
    let calls = 0;
    const failingStarter = async (): Promise<StartedLoaderProxy> => {
      calls++;
      throw new Error("boom");
    };

    await expect(start(failingStarter, fakeProfile)).rejects.toThrow("boom");
    expect(calls).toBe(1);

    const fakeHandle = { server: { close: async () => {} } } as unknown as StartedLoaderProxy;
    const succeedingStarter = async (): Promise<StartedLoaderProxy> => {
      calls++;
      return fakeHandle;
    };

    await start(succeedingStarter, fakeProfile);

    expect(calls).toBe(2);
    await stop();
  });

  it("propagates the not-installed error and clears the in-flight promise when no profile resolves", async () => {
    const starter = async (): Promise<StartedLoaderProxy> => {
      throw new Error("should not be called");
    };
    const rejectingProfile = async (): Promise<RoutingProfile> => {
      throw new Error("no proxy plugin installed");
    };

    await expect(start(starter, rejectingProfile)).rejects.toThrow("no proxy plugin installed");
    await expect(start(async () => ({ server: { close: async () => {} } }) as unknown as StartedLoaderProxy, fakeProfile)).resolves.toBeUndefined();
    await stop();
  });
});

describe("stop", () => {
  it("concurrent calls invoke the injected stopper only once", async () => {
    let closeCalls = 0;
    const fakeHandle = {
      server: {
        close: async () => {
          closeCalls++;
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      },
    } as unknown as StartedLoaderProxy;

    await start(async () => fakeHandle, fakeProfile);
    await Promise.all([stop(), stop()]);

    expect(closeCalls).toBe(1);
  });
});
