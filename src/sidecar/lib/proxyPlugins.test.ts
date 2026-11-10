import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstalledProxies, loadInstalledProxyDefs, resetProxyDefCacheForTests } from "./proxyPlugins.js";
import type { AppDescriptor } from "@intisy-ai/basekit";

// isProxyDef (see proxyPlugins.ts) validates a loaded proxyDef's `app` id against
// getAppDescriptor(), which now reads solely from the apps.json registry, so
// these fixtures need a seeded "claude" entry for the proxyDef.app to resolve.
const claudeApp: AppDescriptor = {
  id: "claude",
  label: "Claude Code",
  home: { candidates: ["/nonexistent/claude-home"] },
  detect: { binary: "claude", pkg: "claude-code" },
  commandsSubdir: "commands",
  proxyPort: 41101,
  integration: "native",
  wireFormat: "anthropic",
};

let appsRegistryDir: string;
let savedHubAppsFile: string | undefined;

beforeEach(() => {
  appsRegistryDir = mkdtempSync(join(tmpdir(), "proxy-plugins-registry-"));
  savedHubAppsFile = process.env.HUB_APPS_FILE;
  process.env.HUB_APPS_FILE = join(appsRegistryDir, "apps.json");
  writeFileSync(process.env.HUB_APPS_FILE, JSON.stringify({ claude: claudeApp }));
});

afterEach(() => {
  rmSync(appsRegistryDir, { recursive: true, force: true });
  if (savedHubAppsFile === undefined) delete process.env.HUB_APPS_FILE;
  else process.env.HUB_APPS_FILE = savedHubAppsFile;
});

// The clone layout is what these tests are about; the registered list is what the home's manager
// answers, so it is stated as `listed(names)` and injected rather than written to a file nothing
// reads any more.
function listed(names: string[]) {
  return async () => names.map((id) => ({ id, enabled: true }));
}

function seedStore(storeDir: string, names: string[]): void {
  mkdirSync(join(storeDir, "config"), { recursive: true });
  for (const name of names) {
    const distDir = join(storeDir, "repos", name, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "index.js"), "export const proxyDef = {};\n");
  }
}

function bumpMtime(path: string): void {
  const future = new Date(Date.now() + 60_000);
  utimesSync(path, future, future);
}

describe("loadInstalledProxyDefs", () => {
  let tempDir: string;

  afterEach(() => {
    resetProxyDefCacheForTests();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads duck-typed proxyDef from plugins declaring the front-door capability only", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "proxy-plugins-"));
    seedStore(tempDir, ["fake-proxy", "provider-stub"]);
    const defs = await loadInstalledProxyDefs(tempDir, {
      importFn: async (url) =>
        url.includes("fake-proxy") ? { proxyDef: { app: "claude", label: "Claude Code", profile: () => ({}) } } : {},
      providesFrontDoor: (_dir, name) => name === "fake-proxy",
      listPlugins: listed(["fake-proxy", "provider-stub"]),
    });
    expect(defs).toHaveLength(1);
    expect(defs[0].app).toBe("claude");
  });

  it("skips repos whose export is missing or malformed", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "proxy-plugins-"));
    seedStore(tempDir, ["bad-proxy"]);
    const defs = await loadInstalledProxyDefs(tempDir, {
      importFn: async () => ({ proxyDef: { app: "claude" } }),
      providesFrontDoor: (_dir, name) => name === "bad-proxy",
      listPlugins: listed(["bad-proxy"]),
    });
    expect(defs).toEqual([]);
  });

  it("caches per dist mtime and reloads after change", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "proxy-plugins-"));
    seedStore(tempDir, ["fake-proxy"]);
    let hits = 0;
    const urls: string[] = [];
    const importFn = async (url: string) => {
      urls.push(url);
      hits++;
      return { proxyDef: { app: "claude", label: "C", profile: () => ({}) } };
    };
    const providesFrontDoor = (_dir: string, name: string) => name === "fake-proxy";
    const listPlugins = listed(["fake-proxy"]);
    await loadInstalledProxyDefs(tempDir, { importFn, providesFrontDoor, listPlugins });
    await loadInstalledProxyDefs(tempDir, { importFn, providesFrontDoor, listPlugins });
    expect(hits).toBe(1);

    bumpMtime(join(tempDir, "repos", "fake-proxy", "dist", "index.js"));
    await loadInstalledProxyDefs(tempDir, { importFn, providesFrontDoor, listPlugins });
    expect(hits).toBe(2);
    expect(urls[1]).not.toBe(urls[0]);
  });

  it("selects a proxy by its declared front-door capability, not by its name", async () => {
    const declared = new Set(["gateway"]);
    const proxies = await listInstalledProxies("/nonexistent/proxy-plugins-home", {
      listPlugins: listed(["gateway", "looks-like-a-proxy"]),
      providesFrontDoor: (_dir, name) => declared.has(name),
    });
    expect(proxies.map((p) => p.name)).toEqual(["gateway"]);
    expect(proxies[0].def).toBeNull();
  });

  it("selects a proxy whose front-door capability comes only from the clone's own manifest, with no deployed sidecar", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "proxy-plugins-"));
    seedStore(tempDir, ["gateway"]);
    writeFileSync(join(tempDir, "repos", "gateway", "plugin.json"), JSON.stringify({ id: "gateway", capabilities: ["front-door"] }));
    const defs = await loadInstalledProxyDefs(tempDir, {
      importFn: async () => ({ proxyDef: { app: "claude", label: "Claude Code", profile: () => ({}) } }),
      listPlugins: listed(["gateway"]),
    });
    expect(defs).toHaveLength(1);
    expect(defs[0].app).toBe("claude");
  });
});
