import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCoreProxy } from "@intisy-ai/basekit/proxy";
import type { LoadedProxyDef } from "../lib/proxyPlugins.js";
import type { AppDescriptor } from "@intisy-ai/basekit";
import { fixtureRoutingProfile } from "../lib/routingProfileFixture.js";

beforeAll(() => initCoreProxy());

// getApps()/getAppDescriptor() now read solely from the apps.json registry (see
// libs/basekit/src/apps.ts), so these tests need a seeded "claude" entry. Its home
// candidate points at the OS temp dir, which always exists, so appsDetect()'s
// real (non-injected) presence check is stable across machines.
const claudeApp: AppDescriptor = {
  id: "claude",
  label: "Claude Code",
  home: { candidates: [tmpdir()] },
  detect: { binary: "claude", pkg: "claude-code" },
  commandsSubdir: "commands",
  proxyPort: 41101,
  integration: "native",
  wireFormat: "anthropic",
};

async function fakeDefs(): Promise<LoadedProxyDef[]> {
  return [{ app: "claude", label: "Claude Code", profile: fixtureRoutingProfile }];
}
const proxyDeps = { defs: fakeDefs };

function deployStubProvider(configDir: string): void {
  const repo = join(configDir, "repos", "stub-auth");
  mkdirSync(repo, { recursive: true });
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ claudeHub: { authProviders: [{ name: "stub", handler: "dist/index.js" }] } }),
  );
}

function seedAppHome(homeDir: string): void {
  const configDir = join(homeDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "accounts.json"),
    JSON.stringify({
      version: 1,
      providers: {
        stub: {
          accounts: [{ id: "acc-1", email: "acc-1@example.com", refresh: "r1", enabled: true }],
          activeIndex: 0,
          activeIndexByLane: {},
        },
      },
    }),
  );
  writeFileSync(
    join(configDir, fixtureRoutingProfile().configFile),
    JSON.stringify({ modelMap: { opus: [{ provider: "stub", model: "m-opus" }] } }),
  );
}

beforeEach(() => {
  process.env.HUB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "dash-import-"));
  process.env.HUB_APPS_FILE = join(process.env.HUB_CONFIG_DIR, "apps.json");
  writeFileSync(process.env.HUB_APPS_FILE, JSON.stringify({ claude: claudeApp }));
});

describe("import", () => {
  it("reports importable apps with hasConfig flags", async () => {
    const { importApps } = await import("./import.js");
    const r = await importApps();
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.isArray(r.data)).toBe(true);
  });

  it("reports hasConfig:false for an app whose injected home does not exist", async () => {
    const { importApps } = await import("./import.js");
    const missingHome = join(process.env.HUB_CONFIG_DIR!, "nowhere");
    const r = await importApps({ appHome: () => missingHome });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data.every((a) => a.hasConfig === false)).toBe(true);
  });

  it("imports accounts and routing from the app's real home into Forebay's own store", async () => {
    deployStubProvider(process.env.HUB_CONFIG_DIR!);
    const appHomeDir = mkdtempSync(join(tmpdir(), "dash-import-app-home-"));
    seedAppHome(appHomeDir);

    const { importRun } = await import("./import.js");
    const result = await importRun("claude", undefined, { appHome: () => appHomeDir, proxyDeps });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.accounts).toBeGreaterThanOrEqual(1);
    expect(result.data.providers).toBe(1);
    expect(result.data.routingImported).toBe(true);

    const { listAccounts, getConfigDir } = await import("@intisy-ai/basekit/auth");
    const imported = listAccounts("stub", undefined) as { id: string }[];
    expect(imported.some((a) => a.id === "acc-1")).toBe(true);

    const { resolveModelMap } = await import("@intisy-ai/basekit/proxy");
    const { profileFor } = await import("../lib/proxyRegistry.js");
    const profile = await profileFor("claude", proxyDeps);
    if (!profile) throw new Error("unreachable");
    const map = resolveModelMap(getConfigDir(), profile);
    expect(map.opus).toEqual([{ provider: "stub", model: "m-opus", name: "m-opus", derived: false }]);

    const { getConfigValue } = await import("@intisy-ai/basekit");
    const exposure = getConfigValue("dashboard-exposure", "map") as Record<string, { claude: boolean }>;
    expect(exposure.stub.claude).toBe(true);
  });

  it("previews accounts, routing slots, and exposable providers without writing", async () => {
    deployStubProvider(process.env.HUB_CONFIG_DIR!);
    const appHomeDir = mkdtempSync(join(tmpdir(), "dash-import-app-home-"));
    seedAppHome(appHomeDir);

    const { importPreview } = await import("./import.js");
    const result = await importPreview("claude", { appHome: () => appHomeDir, proxyDeps });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.accounts).toBe(1);
    expect(result.data.exposedProviders).toBeGreaterThanOrEqual(1);
    expect(result.data.routingSlots).toBe(2);
  });

  it("skips categories that are not selected", async () => {
    deployStubProvider(process.env.HUB_CONFIG_DIR!);
    const appHomeDir = mkdtempSync(join(tmpdir(), "dash-import-app-home-"));
    seedAppHome(appHomeDir);

    const { importRun } = await import("./import.js");
    const result = await importRun("claude", { accounts: false, routing: true, exposure: true }, { appHome: () => appHomeDir, proxyDeps });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.accounts).toBe(0);
    expect(result.data.notes.some((n) => n.toLowerCase().includes("account") && n.toLowerCase().includes("skip"))).toBe(true);
  });

});
