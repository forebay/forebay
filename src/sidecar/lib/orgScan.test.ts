import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanOrg, resetOrgScanCache } from "./orgScan.js";

beforeEach(() => {
  resetOrgScanCache();
  // resolveToken now falls through to a Cairn-config token, so isolate every test
  // from whatever real config dir the developer/CI machine happens to have.
  process.env.HUB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "dash-orgscan-"));
});

const repo = (name: string, topics: string[] = ["plugin"], archived = false) => ({
  name,
  html_url: `https://github.com/forebay/${name}`,
  description: `${name} desc`,
  archived,
  topics,
});
const okFetch = (repos: unknown[]) => (async () => ({ ok: true, status: 200, json: async () => repos })) as unknown as typeof fetch;

describe("scanOrg", () => {
  it("lists only repos carrying an installable category topic, mapping the topic to a kind", async () => {
    const result = await scanOrg({
      fetchFn: okFetch([
        repo("stub-auth", ["forebay", "ai-provider"]),
        repo("core-ir", ["forebay", "core-library"]),
        repo("agentbox", []),
        repo("opencode-proxy", ["forebay", "app-proxy"]),
      ]),
      env: { GITHUB_TOKEN: "t" },
      execFn: async () => "",
    });
    expect(result.source).toBe("env");
    expect(result.entries.map((e) => [e.name, e.kind])).toEqual([
      ["stub-auth", "provider"],
      ["opencode-proxy", "proxy"],
    ]);
  });

  it("serves the TTL cache within 60s and never clobbers a good result with a failure", async () => {
    let t = 0;
    const now = () => t;
    const good = await scanOrg({ fetchFn: okFetch([repo("stub-auth", ["ai-provider"])]), env: {}, execFn: async () => "", now });
    expect(good.entries).toHaveLength(1);
    t = 61_000;
    const afterFail = await scanOrg({ fetchFn: (async () => { throw new Error("net down"); }) as unknown as typeof fetch, env: {}, execFn: async () => "", now });
    expect(afterFail.entries).toHaveLength(1);
  });

  it("falls back env -> config -> anonymous, never touching the local gh CLI", async () => {
    const withGhPresent = await scanOrg({ fetchFn: okFetch([]), env: {}, execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken\n" : "") });
    expect(withGhPresent.source).toBe("anonymous");
    resetOrgScanCache();
    const anon = await scanOrg({ fetchFn: okFetch([]), env: {}, execFn: async () => { throw new Error("no gh"); } });
    expect(anon.source).toBe("anonymous");
  });

  it("prefers a configured token over an anonymous scan when there is no env token", async () => {
    const { setConfigValue } = await import("@intisy-ai/basekit");
    setConfigValue("cairn", "githubToken", "cfg-token");
    const result = await scanOrg({
      fetchFn: okFetch([]),
      env: {},
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken\n" : ""),
    });
    expect(result.source).toBe("config");
  });

  it("carries repo topics onto the catalog entry", async () => {
    const result = await scanOrg({ fetchFn: okFetch([repo("stub-auth", ["forebay", "ai-provider"])]), env: { GITHUB_TOKEN: "t" }, execFn: async () => "" });
    expect(result.entries.find((e) => e.name === "stub-auth")?.topics).toEqual(["forebay", "ai-provider"]);
  });

  it("enriches an entry with displayName + icon from its manifest", async () => {
    const manifest = { displayName: "Sync Bridge", icon: "icon.svg" };
    const fetchFn = (async (url: string) => {
      if (url.includes("/contents/plugin.json")) return { ok: true, status: 200, json: async () => ({ encoding: "base64", content: Buffer.from(JSON.stringify(manifest)).toString("base64") }) };
      if (url.includes("/contents/icon.svg")) return { ok: true, status: 200, json: async () => ({ encoding: "base64", content: Buffer.from("<svg/>").toString("base64") }) };
      return { ok: true, status: 200, json: async () => [repo("sync-bridge", ["plugin"])] };
    }) as unknown as typeof fetch;
    const result = await scanOrg({ fetchFn, env: { GITHUB_TOKEN: "t" }, execFn: async () => "" });
    const entry = result.entries.find((e) => e.name === "sync-bridge");
    expect(entry?.displayName).toBe("Sync Bridge");
    expect(entry?.icon).toContain("data:image/svg+xml;base64,");
  });

  it("maps an archived installable repo to a deprecated entry instead of skipping it", async () => {
    const result = await scanOrg({
      fetchFn: okFetch([repo("stub-auth", ["ai-provider"]), repo("old-plugin", ["plugin"], true)]),
      env: { GITHUB_TOKEN: "t" },
      execFn: async () => "",
    });
    expect(result.entries.find((e) => e.name === "old-plugin")?.deprecated).toBe(true);
    expect(result.entries.find((e) => e.name === "stub-auth")?.deprecated).toBe(false);
  });

  it("flags rateLimited on a 403 with x-ratelimit-remaining 0, falling back to the empty catalog", async () => {
    const rateLimitedFetch = (async () => ({
      ok: false,
      status: 403,
      headers: { get: (name: string) => (name === "x-ratelimit-remaining" ? "0" : null) },
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const result = await scanOrg({ fetchFn: rateLimitedFetch, env: {}, execFn: async () => "" });
    expect(result.rateLimited).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it("flags rateLimited on a bare 429", async () => {
    const rateLimitedFetch = (async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const result = await scanOrg({ fetchFn: rateLimitedFetch, env: {}, execFn: async () => "" });
    expect(result.rateLimited).toBe(true);
  });

  it("does not flag rateLimited on an unrelated failure", async () => {
    const failFetch = (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const result = await scanOrg({ fetchFn: failFetch, env: {}, execFn: async () => "" });
    expect(result.rateLimited).toBe(false);
  });

  it("reports rateLimited false on a normal successful scan", async () => {
    const result = await scanOrg({ fetchFn: okFetch([repo("stub-auth", ["ai-provider"])]), env: { GITHUB_TOKEN: "t" }, execFn: async () => "" });
    expect(result.rateLimited).toBe(false);
  });

  it("scans the configured marketplace org", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      return { ok: true, status: 200, json: async () => [] };
    }) as unknown as typeof fetch;
    await scanOrg({ fetchFn, getOrg: () => "acme-org", execFn: async () => "" });
    expect(seen.some((u) => u.includes("/orgs/acme-org/repos"))).toBe(true);
  });
});
