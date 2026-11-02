import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverApps } from "./appDiscovery.js";
import { getApps, registerApp } from "@intisy-ai/basekit";
import type { AppDescriptor } from "@intisy-ai/basekit";
import type { CatalogResult } from "../../../packages/shared/src/domain.js";

const gammaApp: AppDescriptor = {
  id: "gamma",
  label: "Gamma CLI",
  home: { candidates: ["/nonexistent/gamma-home"] },
  detect: { binary: "gamma", pkg: "gamma-cli" },
  loader: { id: "gamma-loader", url: "acme-org/gamma-loader" },
  commandsSubdir: "commands",
  proxyPort: 41001,
  integration: "env-baseurl",
  wireFormat: "generic-wire",
};

function emptyScan(): Promise<CatalogResult> {
  return Promise.resolve({ entries: [], source: "anonymous", org: "acme-org" });
}

function scanWithLoader(app: AppDescriptor): () => Promise<CatalogResult> {
  return () =>
    Promise.resolve({
      entries: [{ name: app.loader!.id, url: `https://github.com/acme-org/${app.loader!.id}`, kind: "host", description: "", deprecated: false, topics: ["app-loader"], app }],
      source: "env",
      org: "acme-org",
    });
}

describe("discoverApps", () => {
  let tempDir: string;
  let savedHubAppsFile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "app-discovery-"));
    savedHubAppsFile = process.env.HUB_APPS_FILE;
    process.env.HUB_APPS_FILE = join(tempDir, "apps.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (savedHubAppsFile === undefined) delete process.env.HUB_APPS_FILE;
    else process.env.HUB_APPS_FILE = savedHubAppsFile;
  });

  it("registers an org-scan loader entry that carries an app block", async () => {
    expect(getApps()).toEqual([]);
    await discoverApps({ scanOrgFn: scanWithLoader(gammaApp), exists: () => false });
    const apps = getApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe("gamma");
    expect(apps[0].label).toBe("Gamma CLI");
  });

  it("performs no write on a second call with identical data", async () => {
    await discoverApps({ scanOrgFn: scanWithLoader(gammaApp), exists: () => false });
    const registered: AppDescriptor[] = [];
    await discoverApps({
      scanOrgFn: scanWithLoader(gammaApp),
      exists: () => false,
      registerAppFn: (desc) => {
        registered.push(desc);
        registerApp(desc);
      },
    });
    expect(registered).toEqual([]);
  });

  it("registers nothing for a loader-kind entry without an app block", async () => {
    const scan = () =>
      Promise.resolve({
        entries: [{ name: "gamma-loader", url: "https://github.com/acme-org/gamma-loader", kind: "host" as const, description: "", deprecated: false, topics: ["app-loader"] }],
        source: "env" as const,
        org: "acme-org",
      });
    await discoverApps({ scanOrgFn: scan, exists: () => false });
    expect(getApps()).toEqual([]);
  });

  it("does not throw and registers nothing when the org scan is empty (no token)", async () => {
    await expect(discoverApps({ scanOrgFn: emptyScan, exists: () => false })).resolves.toBeUndefined();
    expect(getApps()).toEqual([]);
  });

  it("refreshes a known app from its installed loader's on-disk manifest", async () => {
    registerApp(gammaApp);
    const updated: AppDescriptor = { ...gammaApp, label: "Gamma CLI (updated)" };
    const readFile = (path: string) => (path.endsWith("plugin.json") ? JSON.stringify({ app: updated }) : "");
    await discoverApps({ scanOrgFn: emptyScan, exists: () => true, readFile });
    expect(getApps().find((a) => a.id === "gamma")?.label).toBe("Gamma CLI (updated)");
  });

  it("decodes the loader's catalog icon (a data URI) into the descriptor", async () => {
    const svg = "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>";
    const dataUri = "data:image/svg+xml;base64," + Buffer.from(svg, "utf-8").toString("base64");
    const scan = () =>
      Promise.resolve({
        entries: [{ name: gammaApp.loader!.id, url: `https://github.com/acme-org/${gammaApp.loader!.id}`, kind: "host" as const, description: "", deprecated: false, topics: ["app-loader"], app: gammaApp, icon: dataUri }],
        source: "env" as const,
        org: "acme-org",
      });
    await discoverApps({ scanOrgFn: scan, exists: () => false });
    expect(getApps().find((a) => a.id === "gamma")?.icon).toBe(svg);
  });

  it("attaches the loader's icon.svg to the descriptor from its installed clone", async () => {
    registerApp(gammaApp);
    const svg = "<svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg>";
    const readFile = (path: string) => {
      if (path.endsWith("plugin.json")) return JSON.stringify({ app: gammaApp, icon: "icon.svg" });
      if (path.endsWith("icon.svg")) return svg;
      return "";
    };
    await discoverApps({ scanOrgFn: emptyScan, exists: () => true, readFile });
    expect(getApps().find((a) => a.id === "gamma")?.icon).toBe(svg);
  });

  it("never throws when the installed manifest is malformed", async () => {
    registerApp(gammaApp);
    await expect(
      discoverApps({ scanOrgFn: emptyScan, exists: () => true, readFile: () => "{ not json" }),
    ).resolves.toBeUndefined();
    expect(getApps().find((a) => a.id === "gamma")?.label).toBe("Gamma CLI");
  });

  it("re-registers when only a declared trait changed", async () => {
    const registered: AppDescriptor[] = [];
    const existing = { id: "app-a", label: "App A", home: "~/.app-a", loader: { id: "app-a-loader", url: "https://example/l" } } as AppDescriptor;
    await discoverApps({
      scanOrgFn: async () => ({ entries: [{ kind: "host", app: { ...existing, accent: "#5fafaf" } }] } as never),
      getAppsFn: () => [existing],
      registerAppFn: (desc) => { registered.push(desc); },
      exists: () => false,
      readFile: () => "",
    });
    expect(registered.map((d) => (d as { accent?: string }).accent)).toEqual(["#5fafaf"]);
  });

  it("still touches nothing when the descriptor is unchanged, traits included", async () => {
    const registered: AppDescriptor[] = [];
    const existing = { id: "app-a", label: "App A", home: "~/.app-a", accent: "#5fafaf", loader: { id: "app-a-loader", url: "https://example/l" } } as AppDescriptor;
    await discoverApps({
      scanOrgFn: async () => ({ entries: [{ kind: "host", app: { ...existing } }] } as never),
      getAppsFn: () => [existing],
      registerAppFn: (desc) => { registered.push(desc); },
      exists: () => false,
      readFile: () => "",
    });
    expect(registered).toEqual([]);
  });
});
