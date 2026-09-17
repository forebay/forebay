import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appsDetect, appsInstallCli, appsUninstallCli, appsSummary, appsConnection, appsInstallLoader } from "./apps.js";
import type { AppDescriptor } from "@intisy-ai/basekit";

function descWithLoader(loaderId: string): AppDescriptor {
  return { loader: { id: loaderId, url: `org/${loaderId}` } } as unknown as AppDescriptor;
}

const loaderUrl = (loaderId: string): string => `org/${loaderId}`;

// getAppDescriptor/getApps now read solely from apps.json (see libs/basekit/src/apps.ts),
// so every test exercising a real (non-injected) descriptor lookup needs a seeded
// registry with generic fixture apps instead of relying on a builtin app list.
const alphaApp: AppDescriptor = {
  id: "alpha",
  label: "Alpha CLI",
  home: { candidates: ["/nonexistent/alpha-home"] },
  detect: { binary: "alpha", pkg: "alpha-cli" },
  commandsSubdir: "commands",
  proxyPort: 41001,
  integration: "env-baseurl",
  wireFormat: "generic-wire",
};

const betaApp: AppDescriptor = {
  id: "beta",
  label: "Beta CLI",
  home: { candidates: ["/nonexistent/beta-home"] },
  detect: { binary: "beta", pkg: "beta-cli" },
  commandsSubdir: "commands",
  proxyPort: 41002,
  integration: "env-baseurl",
  wireFormat: "generic-wire",
};

let appsRegistryDir: string;
let savedHubAppsFile: string | undefined;

beforeEach(() => {
  appsRegistryDir = mkdtempSync(join(tmpdir(), "apps-registry-"));
  savedHubAppsFile = process.env.HUB_APPS_FILE;
  process.env.HUB_APPS_FILE = join(appsRegistryDir, "apps.json");
  writeFileSync(process.env.HUB_APPS_FILE, JSON.stringify({ alpha: alphaApp, beta: betaApp }));
});

afterEach(() => {
  rmSync(appsRegistryDir, { recursive: true, force: true });
  if (savedHubAppsFile === undefined) delete process.env.HUB_APPS_FILE;
  else process.env.HUB_APPS_FILE = savedHubAppsFile;
});

describe("apps sidecar module", () => {
  it("detects alpha present via binary and beta absent", async () => {
    const result = await appsDetect({
      binaryExists: (name) => name === "alpha",
      fsExists: () => false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ alpha: true, beta: false });
  });

  it("detects beta present via config dir when no binary is on PATH", async () => {
    const result = await appsDetect({
      binaryExists: () => false,
      fsExists: (path) => path.includes("beta"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ alpha: false, beta: true });
  });

  it("reports both absent when neither the binary nor the config dir is found", async () => {
    const result = await appsDetect({ binaryExists: () => false, fsExists: () => false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ alpha: false, beta: false });
  });

  it("installs an app's npm package as an arg-array spawn, not a shell string", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const fakeSpawn = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return { stdout: "installed", stderr: "" };
    };
    const result = await appsInstallCli("alpha", fakeSpawn);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ stdout: "installed", stderr: "" });
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("npm");
    expect(calls[0].args).toEqual(["install", "-g", "alpha-cli"]);
  });

  it("installs another app's npm package as an arg-array spawn", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const fakeSpawn = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return { stdout: "", stderr: "" };
    };
    const result = await appsInstallCli("beta", fakeSpawn);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("npm");
    expect(calls[0].args).toContain("beta-cli");
  });

  it("returns an error for an unknown app instead of spawning", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const fakeSpawn = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return { stdout: "", stderr: "" };
    };
    const result = await appsInstallCli("bogus" as never, fakeSpawn);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

});

describe("appsUninstallCli", () => {
  it("uninstalls the CLI package and keeps data by default", async () => {
    const spawned: string[][] = [];
    const removed: string[] = [];
    const result = await appsUninstallCli("alpha", false, {
      spawn: async (f, a) => {
        spawned.push([f, ...a]);
        return { stdout: "", stderr: "" };
      },
      rm: (p) => removed.push(p),
      appHome: () => "/fake/alpha-home",
    });
    expect(result.ok).toBe(true);
    expect(spawned[0]).toEqual(["npm", "uninstall", "-g", "alpha-cli"]);
    expect(removed).toEqual([]);
  });

  it("wipes the app home when asked", async () => {
    const removed: string[] = [];
    const result = await appsUninstallCli("beta", true, {
      spawn: async () => ({ stdout: "", stderr: "" }),
      rm: (p) => removed.push(p),
      appHome: () => "/fake/beta-home",
    });
    expect(result.ok).toBe(true);
    expect(removed).toEqual(["/fake/beta-home"]);
  });

  it("returns an error for an unknown app instead of spawning or removing", async () => {
    const spawned: string[][] = [];
    const removed: string[] = [];
    const result = await appsUninstallCli("bogus" as never, true, {
      spawn: async (f, a) => {
        spawned.push([f, ...a]);
        return { stdout: "", stderr: "" };
      },
      rm: (p) => removed.push(p),
    });
    expect(result.ok).toBe(false);
    expect(spawned).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });
});

describe("appsSummary", () => {
  let tempHome: string;
  let tempForebayDir: string;
  let savedHubConfigDir: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "apps-summary-home-"));
    mkdirSync(join(tempHome, "config"), { recursive: true });
    tempForebayDir = mkdtempSync(join(tmpdir(), "apps-summary-forebay-"));
    savedHubConfigDir = process.env.HUB_CONFIG_DIR;
    process.env.HUB_CONFIG_DIR = tempForebayDir;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(tempForebayDir, { recursive: true, force: true });
    if (savedHubConfigDir === undefined) delete process.env.HUB_CONFIG_DIR;
    else process.env.HUB_CONFIG_DIR = savedHubConfigDir;
  });

  it("summarizes accounts, plugin count, and config dir from the app home", async () => {
    writeFileSync(
      join(tempHome, "config", "accounts.json"),
      JSON.stringify({
        providers: {
          antigravity: {
            accounts: [
              { id: "acc-1", email: "a@example.com", enabled: true, meta: { cachedQuota: { pool: { remainingFraction: 0.62 } } } },
            ],
          },
          "claude-code": { accounts: [{ id: "acct-2", enabled: false }] },
        },
      }),
      "utf8",
    );
    // The count comes from whatever manages the home, not from reading its list here, so the
    // fixture states what that manager answers rather than writing a plugins.json nothing reads.
    const result = await appsSummary("alpha", {
      appHome: () => tempHome,
      listPlugins: () => [{ id: "plugin-a" }, { id: "plugin-b" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.configDir).toBe(tempHome);
    expect(result.data.pluginCount).toBe(2);
    expect(result.data.accounts).toEqual([
      { provider: "antigravity", label: "a@example.com", enabled: true, quotaPct: 62 },
      { provider: "claude-code", label: "acct-2", enabled: false, quotaPct: null },
    ]);
    expect(result.data.providerCount).toBe(2);
    expect(result.data.accountsEnabled).toBe(1);
    expect(result.data.providerBreakdown).toEqual([
      { provider: "antigravity", accounts: 1, enabled: 1 },
      { provider: "claude-code", accounts: 1, enabled: 0 },
    ]);
    expect(result.data.quotaMinPct).toBe(62);
  });

  it("aggregates provider breakdown sorted by accounts desc and the lowest reported quota", async () => {
    writeFileSync(
      join(tempHome, "config", "accounts.json"),
      JSON.stringify({
        providers: {
          antigravity: {
            accounts: [
              { id: "acc-1", email: "a@example.com", enabled: true, meta: { cachedQuota: { pool: { remainingFraction: 0.62 } } } },
              { id: "acc-2", email: "b@example.com", enabled: true, meta: { cachedQuota: { pool: { remainingFraction: 0.2 } } } },
            ],
          },
          "claude-code": {
            accounts: [{ id: "acc-3", enabled: false }],
          },
        },
      }),
      "utf8",
    );

    const result = await appsSummary("alpha", { appHome: () => tempHome });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.providerCount).toBe(2);
    expect(result.data.accountsEnabled).toBe(2);
    expect(result.data.providerBreakdown).toEqual([
      { provider: "antigravity", accounts: 2, enabled: 2 },
      { provider: "claude-code", accounts: 1, enabled: 0 },
    ]);
    expect(result.data.quotaMinPct).toBe(20);
  });

  it("returns an empty summary when there is no accounts.json or plugins.json", async () => {
    const result = await appsSummary("beta", { appHome: () => tempHome });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.accounts).toEqual([]);
    expect(result.data.pluginCount).toBe(0);
    expect(result.data.configDir).toBe(tempHome);
    expect(result.data.providerCount).toBe(0);
    expect(result.data.accountsEnabled).toBe(0);
    expect(result.data.providerBreakdown).toEqual([]);
    expect(result.data.quotaMinPct).toBeNull();
  });

  it("returns an error for an unknown app", async () => {
    const result = await appsSummary("bogus" as never, { appHome: () => tempHome });
    expect(result.ok).toBe(false);
  });

  it("reports cli presence and a loader installed in the app home", async () => {
    const result = await appsConnection("app1", {
      getDescriptor: () => descWithLoader("app1-loader"),
      detect: async () => ({ ok: true, data: { app1: true } }),
      appHome: (app) => `/home/${app}`,
      listPlugins: (dir) => (dir === "/home/app1" ? [{ id: "app1-loader" }] : []),
    });
    expect(result).toEqual({ ok: true, data: { app: "app1", cliPresent: true, loaderId: "app1-loader", loaderUrl: loaderUrl("app1-loader"), loaderInstalled: true } });
  });

  it("reports the loader not installed when its plugin is absent from the home", async () => {
    const result = await appsConnection("app1", {
      getDescriptor: () => descWithLoader("app1-loader"),
      detect: async () => ({ ok: true, data: { app1: false } }),
      appHome: () => "/home/app1",
      listPlugins: () => [],
    });
    expect(result).toEqual({ ok: true, data: { app: "app1", cliPresent: false, loaderId: "app1-loader", loaderUrl: loaderUrl("app1-loader"), loaderInstalled: false } });
  });

  it("reports loaderId null for an app that declares no loader", async () => {
    const result = await appsConnection("app1", {
      getDescriptor: () => ({} as unknown as AppDescriptor),
      detect: async () => ({ ok: true, data: { app1: true } }),
      appHome: () => "/home/app1",
      listPlugins: () => [{ id: "unrelated" }],
    });
    expect(result).toEqual({ ok: true, data: { app: "app1", cliPresent: true, loaderId: null, loaderUrl: null, loaderInstalled: false } });
  });

  it("appsConnection errors for an unknown app", async () => {
    const result = await appsConnection("nope", { getDescriptor: () => undefined });
    expect(result.ok).toBe(false);
  });

  it("installs the loader into the app home using the descriptor id and url", async () => {
    const calls: Array<[string, string, string]> = [];
    const result = await appsInstallLoader("app1", {
      getDescriptor: () => descWithLoader("app1-loader"),
      install: async (home, name, url) => { calls.push([home, name, url]); return { ok: true, data: undefined }; },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["app1", "app1-loader", "org/app1-loader"]]);
  });

  it("appsInstallLoader errors when the app declares no loader", async () => {
    const result = await appsInstallLoader("app1", { getDescriptor: () => ({} as unknown as AppDescriptor) });
    expect(result.ok).toBe(false);
  });

  it("appsInstallLoader propagates an install failure", async () => {
    const result = await appsInstallLoader("app1", {
      getDescriptor: () => descWithLoader("app1-loader"),
      install: async () => ({ ok: false, error: "boom" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("boom");
  });
});
