import { describe, it, expect, vi } from "vitest";
import type { InstalledProxy } from "../lib/proxyPlugins.js";
import { proxiesList, proxiesSetEnabled } from "./proxies.js";

describe("proxiesList", () => {
  it("maps installed -proxy plugins to ProxyView, including enabled state and setup", async () => {
    const installed: InstalledProxy[] = [
      { name: "some-proxy", enabled: true, def: { app: "some-app", label: "Some App", profile: () => ({}) as never, setup: "Point Some App at the URL." } },
      { name: "other-proxy", enabled: false, def: { app: "other-app", label: "Other App", profile: () => ({}) as never } },
    ];
    const result = await proxiesList({ listInstalledProxies: async () => installed });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual([
      { name: "some-proxy", app: "some-app", appLabel: "Some App", enabled: true, setup: "Point Some App at the URL." },
      { name: "other-proxy", app: "other-app", appLabel: "Other App", enabled: false, setup: undefined },
    ]);
  });

  it("skips a -proxy plugin whose def failed to load", async () => {
    const installed: InstalledProxy[] = [{ name: "broken-proxy", enabled: true, def: null }];
    const result = await proxiesList({ listInstalledProxies: async () => installed });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it("returns an empty list when no proxies are installed", async () => {
    const result = await proxiesList({ listInstalledProxies: async () => [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});

describe("proxiesSetEnabled", () => {
  it("delegates to the injected pluginsSetEnabled scoped to the forebay home", async () => {
    const pluginsSetEnabled = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const result = await proxiesSetEnabled("some-proxy", false, { pluginsSetEnabled });
    expect(result.ok).toBe(true);
    expect(pluginsSetEnabled).toHaveBeenCalledWith("forebay", "some-proxy", false);
  });

  it("surfaces an error result from pluginsSetEnabled", async () => {
    const pluginsSetEnabled = vi.fn(async () => ({ ok: false as const, error: "plugin not found: some-proxy" }));
    const result = await proxiesSetEnabled("some-proxy", true, { pluginsSetEnabled });
    expect(result.ok).toBe(false);
  });
});
