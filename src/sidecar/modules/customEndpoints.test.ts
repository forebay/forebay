import { describe, it, expect, vi } from "vitest";
import { customEndpointsList, customEndpointsUpsert, customEndpointsRemove, customEndpointsSaveKey, customEndpointsFormats } from "./customEndpoints.js";
import type { EndpointsApi } from "./customEndpoints.js";

// The provider plugin owns what an endpoint is and where it goes; this module only reaches it
// and passes calls through. So what is worth asserting is that it reaches the right plugin,
// forwards faithfully, and says something useful when the plugin is not installed.

const EP = { id: "local", label: "Local", baseUrl: "https://ep.test/v1", format: "openai", models: ["gpt-4o"] };

function fakePlugin(overrides: Partial<EndpointsApi> = {}): { api: EndpointsApi; calls: string[] } {
  const calls: string[] = [];
  const api: EndpointsApi = {
    SUPPORTED_FORMATS: ["openai", "anthropic"],
    validateEndpoint: () => null,
    upsertEndpoint: (endpoint, repoDir) => { calls.push(`upsert:${endpoint.id}:${repoDir ?? ""}`); },
    removeEndpoint: (id, repoDir) => { calls.push(`remove:${id}:${repoDir ?? ""}`); },
    endpointViews: () => [{ ...EP, hasKey: true }],
    saveKey: (id, key) => { calls.push(`key:${id}:${key}`); },
    ...overrides,
  };
  return { api, calls };
}

// ownerPlugin stands in for the real deployed-manifest lookup, which has nothing to find for a
// fixture home that was never deployed. Without this seam, every write-path test below threw
// "no plugin provides custom endpoints" before its injected loadPlugin was ever consulted.
const withPlugin = (api: EndpointsApi) => ({ dir: "/home", loadPlugin: async () => api, ownerPlugin: () => "custom-provider" });
const withoutPlugin = { dir: "/home", loadPlugin: async () => null, ownerPlugin: () => "custom-provider" };

describe("customEndpoints module", () => {
  it("lists what the plugin reports, including whether a key is set", async () => {
    const { api } = fakePlugin();
    const result = await customEndpointsList(withPlugin(api));
    expect(result).toEqual({ ok: true, data: [{ ...EP, hasKey: true }] });
  });

  // The formats come from the plugin that translates them, so the dashboard cannot offer one
  // the plugin could not serve.
  it("reports the formats the plugin says it supports", async () => {
    const { api } = fakePlugin();
    expect(await customEndpointsFormats(withPlugin(api))).toEqual({ ok: true, data: ["openai", "anthropic"] });
  });

  it("hands an upsert to the plugin along with the clone it should re-materialise", async () => {
    const { api, calls } = fakePlugin();
    expect((await customEndpointsUpsert(EP, withPlugin(api))).ok).toBe(true);
    expect(calls).toEqual([expect.stringMatching(/^upsert:local:.*custom-provider$/)]);
  });

  it("hands a removal to the plugin", async () => {
    const { api, calls } = fakePlugin();
    expect((await customEndpointsRemove("local", withPlugin(api))).ok).toBe(true);
    expect(calls).toEqual([expect.stringMatching(/^remove:local:.*custom-provider$/)]);
  });

  it("hands a key to the plugin", async () => {
    const { api, calls } = fakePlugin();
    expect((await customEndpointsSaveKey("local", "sk-secret", withPlugin(api))).ok).toBe(true);
    expect(calls).toEqual(["key:local:sk-secret"]);
  });

  it("refuses an empty endpoint id or key rather than passing them on", async () => {
    const { api, calls } = fakePlugin();
    expect(await customEndpointsSaveKey("", "sk", withPlugin(api))).toMatchObject({ ok: false });
    expect(await customEndpointsSaveKey("local", "", withPlugin(api))).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  // A refusal from the plugin is the answer, not something to translate or soften here.
  it("reports the plugin's own refusal", async () => {
    const { api } = fakePlugin({
      upsertEndpoint: () => { throw new Error("at least one model id is required"); },
    });
    expect(await customEndpointsUpsert(EP, withPlugin(api))).toEqual({ ok: false, error: "at least one model id is required" });
  });

  it("says the plugin is needed rather than pretending to manage endpoints without it", async () => {
    for (const call of [
      () => customEndpointsList(withoutPlugin),
      () => customEndpointsFormats(withoutPlugin),
      () => customEndpointsUpsert(EP, withoutPlugin),
      () => customEndpointsRemove("local", withoutPlugin),
      () => customEndpointsSaveKey("local", "sk", withoutPlugin),
    ]) {
      expect(await call()).toMatchObject({ ok: false, error: expect.stringContaining("plugin installed") });
    }
  });

  it("loads the plugin from the home it was told to work in", async () => {
    const loadPlugin = vi.fn(async () => fakePlugin().api);
    await customEndpointsList({ dir: "/somewhere/else", loadPlugin, ownerPlugin: () => null });
    expect(loadPlugin).toHaveBeenCalledOnce();
  });

  it("answers an empty list, not an error, when nothing owns the capability", async () => {
    const result = await customEndpointsList({ dir: "/home", ownerPlugin: () => null });
    expect(result).toEqual({ ok: true, data: [] });
  });

  // customEndpointsFormats hits the same "nothing owns the capability" path but is not a list,
  // so it still reports the absence as a failure rather than an empty array.
  it("still reports the plugin as needed for a non-list call when nothing owns the capability", async () => {
    const result = await customEndpointsFormats({ dir: "/home", ownerPlugin: () => null });
    expect(result).toEqual({ ok: false, error: "no plugin provides custom endpoints" });
  });
});
