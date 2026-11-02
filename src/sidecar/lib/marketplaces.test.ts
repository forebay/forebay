import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSources, resolveSources, scanMarketplaces } from "./marketplaces.js";
import { resetOrgScanCache } from "./orgScan.js";
import type { MarketplaceSource } from "../../../packages/shared/src/domain.js";

const demoDir = fileURLToPath(new URL("../../../fixtures/marketplace-demo", import.meta.url));

beforeEach(() => {
  process.env.HUB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "dash-marketplaces-"));
  resetOrgScanCache();
});

function local(id: string, path: string): MarketplaceSource {
  return { id, label: id, type: "local", path };
}

describe("parseSources", () => {
  it("falls back to the built-in org when nothing is configured", () => {
    const sources = parseSources(undefined);
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("github-org");
    expect(sources[0].org).toBeTruthy();
  });

  it("keeps a fully declared source of each type", () => {
    const sources = parseSources([
      { id: "org", type: "github-org", org: "acme" },
      { id: "web", label: "Web", type: "manifest", url: "https://acme.test/m.json" },
      { id: "disk", type: "local", path: "/tmp/m" },
    ]);
    expect(sources.map((s) => s.id)).toEqual(["org", "web", "disk"]);
    expect(sources[1].label).toBe("Web");
    // A source that declares no label is named by its id rather than rendering blank.
    expect(sources[0].label).toBe("org");
  });

  it("drops a source that names no id, no known type, or no location for its type", () => {
    const sources = parseSources([
      { type: "local", path: "/tmp/m" },
      { id: "bad-type", type: "carrier-pigeon", url: "u" },
      { id: "org-without-org", type: "github-org" },
      { id: "manifest-without-url", type: "manifest" },
      { id: "local-without-path", type: "local" },
      { id: "good", type: "local", path: "/tmp/m" },
    ]);
    expect(sources.map((s) => s.id)).toEqual(["good"]);
  });

  it("treats a source switched off as declared but not read", () => {
    const [source] = parseSources([{ id: "off", type: "local", path: "/tmp/m", enabled: false }]);
    expect(source.enabled).toBe(false);
  });
});

describe("resolveSources", () => {
  it("prefers explicitly injected sources over the configured ones", () => {
    expect(resolveSources({ sources: [local("only", demoDir)] }).map((s) => s.id)).toEqual(["only"]);
  });
});

describe("scanMarketplaces", () => {
  it("reads a local marketplace and stamps its entries with the source", async () => {
    const result = await scanMarketplaces({ sources: [local("demo", demoDir)] });

    expect(result.sources).toEqual([
      { id: "demo", label: "demo", type: "local", ok: true, entryCount: 4, error: undefined },
    ]);
    expect(result.entries.map((e) => e.name)).toContain("demo-provider");
    expect(result.entries.every((e) => e.sourceId === "demo")).toBe(true);
    expect(result.entries.find((e) => e.name === "demo-provider")?.displayName).toBe("Demo Provider");
    expect(result.entries.find((e) => e.name === "demo-archived")?.deprecated).toBe(true);
  });

  it("accepts a path that names the manifest file itself", async () => {
    const result = await scanMarketplaces({ sources: [local("demo", join(demoDir, "marketplace.json"))] });
    expect(result.entries.length).toBe(4);
  });

  // The whole point of naming sources: one unreachable marketplace used to be
  // indistinguishable from an empty catalog.
  it("keeps a healthy source's entries when another source fails, and says which failed", async () => {
    const result = await scanMarketplaces({
      sources: [local("demo", demoDir), local("missing", join(tmpdir(), "definitely-not-here"))],
    });

    expect(result.entries.length).toBe(4);
    expect(result.sources.find((s) => s.id === "demo")?.ok).toBe(true);
    const failed = result.sources.find((s) => s.id === "missing");
    expect(failed?.ok).toBe(false);
    expect(failed?.error).toBeTruthy();
    expect(failed?.entryCount).toBe(0);
  });

  it("reports the reason when a manifest source answers with an error status", async () => {
    const result = await scanMarketplaces({
      sources: [{ id: "acme", label: "Acme", type: "manifest", url: "https://acme.test/marketplace.json" }],
      fetchFn: async () => new Response("nope", { status: 404 }),
    });

    expect(result.entries).toEqual([]);
    expect(result.sources[0].error).toContain("404");
  });

  it("reads entries from a manifest source", async () => {
    const body = JSON.stringify({ entries: [{ name: "acme-auth", url: "https://acme.test/auth", kind: "provider", description: "d", topics: ["ai-provider"] }] });
    const result = await scanMarketplaces({
      sources: [{ id: "acme", label: "Acme", type: "manifest", url: "https://acme.test/marketplace.json" }],
      fetchFn: async () => new Response(body, { status: 200 }),
    });

    expect(result.entries.map((e) => e.name)).toEqual(["acme-auth"]);
    expect(result.entries[0].sourceId).toBe("acme");
  });

  it("reads version, methods and installMethod, and always lists the marketplace method", async () => {
    const body = JSON.stringify({ entries: [
      { name: "acme-host", url: "https://acme.test/host", kind: "host", version: "1.2.0", methods: ["npm", "marketplace"], installMethod: "npm" },
      { name: "acme-plain", url: "https://acme.test/plain", kind: "plugin" },
    ] });
    const result = await scanMarketplaces({
      sources: [{ id: "acme", label: "Acme", type: "manifest", url: "https://acme.test/marketplace.json" }],
      fetchFn: async () => new Response(body, { status: 200 }),
    });

    const host = result.entries.find((e) => e.name === "acme-host");
    expect(host).toMatchObject({ kind: "host", version: "1.2.0", methods: ["npm", "marketplace"], installMethod: "npm" });
    expect(result.entries.find((e) => e.name === "acme-plain")?.methods).toEqual(["marketplace"]);
  });

  it("refuses the retired loader kind", async () => {
    const body = JSON.stringify({ entries: [{ name: "old", url: "https://acme.test/old", kind: "loader" }] });
    const result = await scanMarketplaces({
      sources: [{ id: "acme", label: "Acme", type: "manifest", url: "https://acme.test/marketplace.json" }],
      fetchFn: async () => new Response(body, { status: 200 }),
    });
    expect(result.entries).toEqual([]);
  });

  // Config order is precedence, so a name two marketplaces both publish renders once.
  it("lets the first source claim a name both marketplaces publish", async () => {
    const other = mkdtempSync(join(tmpdir(), "dash-mkt-other-"));
    writeFileSync(
      join(other, "marketplace.json"),
      JSON.stringify({ entries: [{ name: "demo-plugin", url: "https://other.test/demo-plugin", kind: "plugin", description: "shadowed" }] }),
    );

    const result = await scanMarketplaces({ sources: [local("demo", demoDir), local("other", other)] });

    const claimed = result.entries.filter((e) => e.name === "demo-plugin");
    expect(claimed).toHaveLength(1);
    expect(claimed[0].sourceId).toBe("demo");
    expect(result.sources.find((s) => s.id === "other")?.entryCount).toBe(0);
  });

  // Priority is the rule, but a dropped entry the user can see in a marketplace has to say
  // why it is not listed.
  it("records which entries a lower-priority source lost, and to whom", async () => {
    const other = mkdtempSync(join(tmpdir(), "dash-mkt-shadow-"));
    writeFileSync(
      join(other, "marketplace.json"),
      JSON.stringify({ entries: [
        { name: "demo-plugin", url: "u", kind: "plugin" },
        { name: "other-only", url: "u", kind: "plugin" },
      ] }),
    );

    const result = await scanMarketplaces({ sources: [local("demo", demoDir), local("other", other)] });

    const loser = result.sources.find((s) => s.id === "other");
    expect(loser?.shadowed).toEqual([{ name: "demo-plugin", by: "demo" }]);
    expect(loser?.entryCount).toBe(1);
    expect(result.entries.map((e) => e.name)).toContain("other-only");
  });

  it("reports no shadowing when the marketplaces publish different names", async () => {
    const result = await scanMarketplaces({ sources: [local("demo", demoDir)] });
    expect(result.sources[0].shadowed).toBeUndefined();
  });

  it("skips manifest entries that name no kind this app understands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-mkt-bad-"));
    writeFileSync(
      join(dir, "marketplace.json"),
      JSON.stringify({ entries: [{ name: "ok", url: "u", kind: "plugin" }, { name: "weird", url: "u", kind: "spaceship" }, { url: "u", kind: "plugin" }] }),
    );

    const result = await scanMarketplaces({ sources: [local("x", dir)] });
    expect(result.entries.map((e) => e.name)).toEqual(["ok"]);
  });
});
