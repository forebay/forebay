import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCoreProxy } from "@intisy-ai/basekit/proxy";
import type { LoadedProxyDef } from "../lib/proxyPlugins.js";
import { fixtureRoutingProfile } from "../lib/routingProfileFixture.js";

beforeAll(() => initCoreProxy());

async function fakeDefs(): Promise<LoadedProxyDef[]> {
  return [{ app: "claude", label: "Claude Code", profile: fixtureRoutingProfile }];
}
const proxyDeps = { defs: fakeDefs };

function deployStubProvider(configDir: string): void {
  const repo = join(configDir, "repos", "provider-stub");
  mkdirSync(repo, { recursive: true });
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ claudeHub: { authProviders: [{ name: "stub", handler: "dist/index.js" }] } }),
  );
}

beforeEach(() => {
  process.env.HUB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "dash-routing-"));
});

describe("routing sidecar module", () => {
  it("returns tiers and an empty catalog on a bare store", async () => {
    const { routingGet } = await import("./routing.js");

    const result = await routingGet("claude", proxyDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.tiers).toEqual(fixtureRoutingProfile().tierFallback);
    expect(result.data.catalog).toEqual([]);
    expect(result.data.map.default).toEqual([]);
  });

  it("persists a chain to a slot and clears it when set empty", async () => {
    const { routingGet, routingSetChain } = await import("./routing.js");
    deployStubProvider(process.env.HUB_CONFIG_DIR!);

    const set = await routingSetChain("claude", "opus", [{ provider: "stub", model: "m" }], proxyDeps);
    expect(set.ok).toBe(true);

    const afterSet = await routingGet("claude", proxyDeps);
    if (!afterSet.ok) throw new Error("unreachable");
    expect(afterSet.data.map.opus).toEqual([{ provider: "stub", model: "m", name: "m", derived: false }]);

    const cleared = await routingSetChain("claude", "opus", [], proxyDeps);
    expect(cleared.ok).toBe(true);

    const afterClear = await routingGet("claude", proxyDeps);
    if (!afterClear.ok) throw new Error("unreachable");
    expect(afterClear.data.map.opus).toEqual([]);
  });

  it("routingGet errors for an app with no available proxy", async () => {
    const { routingGet } = await import("./routing.js");
    const r = await routingGet("nope");
    expect(r.ok).toBe(false);
  });

  it("routingSetChain rejects an unknown provider with ok:false", async () => {
    const { routingSetChain } = await import("./routing.js");
    const r = await routingSetChain("claude", "default", [{ provider: "does-not-exist", model: "x" }], proxyDeps);
    expect(r.ok).toBe(false);
  });

  it("routingSetChain warns (but still persists) on a known provider with a model missing from its catalog", async () => {
    const { routingGet, routingSetChain } = await import("./routing.js");
    deployStubProvider(process.env.HUB_CONFIG_DIR!);

    const catalog = await routingGet("claude", proxyDeps);
    if (!catalog.ok) throw new Error("unreachable");
    expect(catalog.data.catalog).toEqual([]);

    const set = await routingSetChain("claude", "opus", [{ provider: "stub", model: "not-in-catalog" }], proxyDeps);
    expect(set.ok).toBe(true);
    if (!set.ok) throw new Error("unreachable");
    expect(set.data.warnings).toEqual([`unknown model "not-in-catalog" for provider "stub"`]);

    const after = await routingGet("claude", proxyDeps);
    if (!after.ok) throw new Error("unreachable");
    expect(after.data.map.opus).toEqual([{ provider: "stub", model: "not-in-catalog", name: "not-in-catalog", derived: false }]);
  });
});
