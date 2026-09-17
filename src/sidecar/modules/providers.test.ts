import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/pluginHost.js", () => ({
  DEFAULT_CALL_TIMEOUT_MS: 10000,
  capabilityProviders: vi.fn(),
  callHostCapability: async (_id: string, _label: string, _ms: number, call: () => Promise<unknown>) => {
    try { return { ok: true as const, value: await call() }; }
    catch (error) { return { ok: false as const, error: { detail: (error as Error).message, fix: "fix it" } }; }
  },
}));

// The exposure map is provider-and-app-id-keyed config state; these tests pin the app
// registry and the config store to the same in-memory fake exposure.ts itself reads through,
// so providersSetEnabled/providersSetExposure can be asserted without touching real config files.
const exposureState: { apps: { id: string }[]; store: Record<string, unknown> } = { apps: [], store: {} };
vi.mock("@intisy-ai/basekit", () => ({
  getApps: () => exposureState.apps,
  getConfigValue: (name: string, key: string) => exposureState.store[name + ":" + key],
  setConfigValue: (name: string, key: string, value: unknown) => { exposureState.store[name + ":" + key] = value; },
  emitEvent: () => {},
}));

beforeEach(() => {
  exposureState.apps = [{ id: "claude" }, { id: "opencode" }];
  exposureState.store = {};
});

describe("providersList", () => {
  it("labels a lane from the provider capability and keeps the deployed lane's routing data", async () => {
    const { capabilityProviders } = await import("../lib/pluginHost.js");
    (capabilityProviders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { pluginId: "vendor-auth", implementation: { id: "vendor", providers: async () => [
        { id: "vendor", label: "Vendor", hasOAuth: true, accountPool: "vendor" },
        { id: "vendor-cli", label: "Vendor CLI", hasOAuth: true, accountPool: "vendor" },
      ] } },
    ]);
    const { providersList } = await import("./providers.js");
    const result = await providersList({
      homeDir: "/home",
      appId: "forebay",
      deployed: () => [
        { provider: "vendor", repo: "vendor-auth", handler: "dist/handler.js", handlerPath: "/x", translator: undefined, accountPool: "vendor", models: [] },
        { provider: "vendor-cli", repo: "vendor-auth", handler: "dist/handler.js", handlerPath: "/x", translator: "gemini", accountPool: "vendor", models: [] },
      ],
      accountsFor: () => [],
      exposure: () => ({}),
      manifestFor: () => ({}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((row) => [row.id, row.label, row.authKind, row.accountPool, row.translator])).toEqual([
      ["vendor", "Vendor", "oauth", "vendor", undefined],
      ["vendor-cli", "Vendor CLI", "oauth", "vendor", "gemini"],
    ]);
    expect(result.data[0].sharedWith).toEqual(["vendor-cli"]);
  });

  it("falls back to the lane id and records defsError when the capability call fails", async () => {
    const { capabilityProviders } = await import("../lib/pluginHost.js");
    (capabilityProviders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { pluginId: "vendor-auth-plugin", implementation: { id: "vendor", providers: async () => { throw new Error("lane resolver died"); } } },
    ]);
    const { providersList } = await import("./providers.js");
    const result = await providersList({
      homeDir: "/home",
      appId: "forebay",
      deployed: () => [{ provider: "vendor", repo: "vendor-auth", handler: "dist/handler.js", handlerPath: "/x", translator: undefined, accountPool: "vendor", models: [] }],
      accountsFor: () => [],
      exposure: () => ({}),
      manifestFor: () => ({}),
      pluginIdFor: (repo) => (repo === "vendor-auth" ? "vendor-auth-plugin" : repo),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].label).toBe("vendor");
    expect(result.data[0].defsError).toBe("lane resolver died");
  });

  it("keys defsError by the plugin id the host reports, not the clone directory name", async () => {
    const { capabilityProviders } = await import("../lib/pluginHost.js");
    (capabilityProviders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { pluginId: "vendor-host-id", implementation: { id: "vendor", providers: async () => { throw new Error("lane resolver died"); } } },
    ]);
    const { providersList } = await import("./providers.js");
    const result = await providersList({
      homeDir: "/home",
      appId: "forebay",
      deployed: () => [{ provider: "vendor", repo: "vendor-clone-dir", handler: "dist/handler.js", handlerPath: "/x", translator: undefined, accountPool: "vendor", models: [] }],
      accountsFor: () => [],
      exposure: () => ({}),
      manifestFor: () => ({}),
      pluginIdFor: (repo) => (repo === "vendor-clone-dir" ? "vendor-host-id" : repo),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].defsError).toBe("lane resolver died");
  });

  it("lists a deployed lane no capability describes, rather than dropping it", async () => {
    const { capabilityProviders } = await import("../lib/pluginHost.js");
    (capabilityProviders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { providersList } = await import("./providers.js");
    const result = await providersList({
      homeDir: "/home",
      appId: "forebay",
      deployed: () => [{ provider: "orphan", repo: "gone", handler: "dist/handler.js", handlerPath: "/x", translator: undefined, accountPool: "orphan", models: [] }],
      accountsFor: () => [],
      exposure: () => ({}),
      manifestFor: () => ({}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((row) => row.id)).toEqual(["orphan"]);
    expect(result.data[0].authKind).toBe("api-key");
  });
});

describe("providersSetExposure", () => {
  it("writes an app-id-keyed exposure entry for the provider", async () => {
    const { providersSetExposure } = await import("./providers.js");
    const { readExposureMap } = await import("../lib/exposure.js");
    const result = await providersSetExposure("vendor", "opencode", false);
    expect(result.ok).toBe(true);
    expect(readExposureMap()).toEqual({ vendor: { claude: true, opencode: false } });
  });
});

describe("providersSetEnabled", () => {
  it("does not affect an unrelated provider's exposure", async () => {
    const { providersSetExposure, providersSetEnabled } = await import("./providers.js");
    const { readExposureMap } = await import("../lib/exposure.js");
    await providersSetExposure("other-vendor", "claude", false);

    const result = await providersSetEnabled("vendor", false);

    expect(result.ok).toBe(true);
    const map = readExposureMap();
    expect(map["other-vendor"]).toEqual({ claude: false, opencode: true });
    expect(map.vendor).toEqual({ claude: false, opencode: false });
  });
});
