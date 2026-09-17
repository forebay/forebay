import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { appRealHome, pluginHomes, loaderInstalled, homeById } from "./pluginHomes.js";
import { resolveStoreDir } from "../../main/lib/storeDir.js";
import { resolveAppsFile, type AppDescriptor } from "@intisy-ai/basekit";

// getApps()/getAppDescriptor() now read solely from the apps.json registry (see
// libs/basekit/src/apps.ts), so tests exercising real descriptor lookups need a
// seeded registry instead of relying on a builtin claude/opencode app list.
const claudeApp: AppDescriptor = {
  id: "claude",
  label: "Claude Code",
  home: { candidates: ["~/.claude"] },
  detect: { binary: "claude", pkg: "claude-code" },
  commandsSubdir: "commands",
  proxyPort: 41101,
  integration: "native",
  wireFormat: "anthropic",
};

const opencodeApp: AppDescriptor = {
  id: "opencode",
  label: "OpenCode",
  home: { xdgSubdir: "opencode", candidates: ["~/.config/opencode"] },
  detect: { binary: "opencode", pkg: "opencode-ai" },
  commandsSubdir: "command",
  proxyPort: 41102,
  integration: "native",
  wireFormat: "anthropic",
};

let appsRegistryDir: string;
let savedHubAppsFile: string | undefined;
let savedHubConfigDir: string | undefined;

beforeEach(() => {
  appsRegistryDir = mkdtempSync(join(tmpdir(), "plugin-homes-registry-"));
  savedHubAppsFile = process.env.HUB_APPS_FILE;
  savedHubConfigDir = process.env.HUB_CONFIG_DIR;
  process.env.HUB_APPS_FILE = join(appsRegistryDir, "apps.json");
  writeFileSync(process.env.HUB_APPS_FILE, JSON.stringify({ claude: claudeApp, opencode: opencodeApp }));
});

afterEach(() => {
  rmSync(appsRegistryDir, { recursive: true, force: true });
  if (savedHubAppsFile === undefined) delete process.env.HUB_APPS_FILE;
  else process.env.HUB_APPS_FILE = savedHubAppsFile;
  if (savedHubConfigDir === undefined) delete process.env.HUB_CONFIG_DIR;
  else process.env.HUB_CONFIG_DIR = savedHubConfigDir;
});

describe("appRealHome", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers ~/.claude and XDG opencode", () => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-homes-"));
    mkdirSync(join(tempDir, ".claude"));
    // appRealHome is called with an explicit env object (not process.env) below,
    // so getAppDescriptor falls back to the home-relative apps.json default path.
    const registry = resolveAppsFile({}, tempDir);
    mkdirSync(dirname(registry), { recursive: true });
    writeFileSync(registry, JSON.stringify({ claude: claudeApp, opencode: opencodeApp }));

    expect(appRealHome("claude", {}, tempDir).replaceAll("\\", "/")).toContain("/.claude");
    expect(appRealHome("opencode", { XDG_CONFIG_HOME: "/cfg" }, tempDir).replaceAll("\\", "/")).toBe("/cfg/opencode");
  });
});

describe("pluginHomes", () => {
  // Forebay's own home is the store dir it was launched against, which is where its
  // config, repos and accounts are. Naming an APP's home instead made "install into
  // Forebay" write into Claude's home and listed its plugins twice; naming the app
  // registry's directory instead pointed the plugin list at a directory nothing wrote to,
  // so an installed plugin read as absent.
  it("takes forebay's home from the store dir it was launched against", async () => {
    process.env.HUB_CONFIG_DIR = join(tmpdir(), "forebay-store");
    const homes = await pluginHomes({
      detect: async () => ({ ok: true, data: {} }),
      appHome: () => "/home/app",
      managesPlugins: () => false,
    });
    expect(homes[0].id).toBe("forebay");
    expect(homes[0].dir).toBe(join(tmpdir(), "forebay-store"));
  });

  // Without the launcher's env the fallback still has to be Forebay's own store dir: the
  // app registry sits at a fixed global path shared with the loaders, so it cannot stand
  // in for it, and an app's home is another app's territory.
  it("falls back to the platform store dir rather than an app home or the registry's dir", async () => {
    delete process.env.HUB_CONFIG_DIR;
    const homes = await pluginHomes({
      detect: async () => ({ ok: true, data: {} }),
      appHome: () => "/home/app",
      managesPlugins: () => false,
    });
    expect(homes[0].dir).toBe(resolveStoreDir(process.env, process.platform, homedir()));
    expect(homes[0].dir).not.toBe("/home/app");
    expect(homes[0].dir).not.toBe(dirname(process.env.HUB_APPS_FILE!));
  });

  it("always lists forebay first (present, managesPlugins), then only detected apps", async () => {
    const homes = await pluginHomes({
      detect: async () => ({ ok: true, data: { claude: true, opencode: false } }),
      forebayDir: "/store",
      appHome: (app) => (app === "claude" ? "/home/claude" : "/home/opencode"),
      managesPlugins: () => true,
    });
    expect(homes[0]).toMatchObject({ id: "forebay", present: true, managesPlugins: true, dir: "/store" });
    expect(homes.map((h) => h.id)).toEqual(["forebay", "claude", "opencode"]);
    expect(homes.find((h) => h.id === "opencode")?.present).toBe(false);
  });

  it("managesPlugins reflects whether plugin-updater is actually installed in a home", async () => {
    const homes = await pluginHomes({
      detect: async () => ({ ok: true, data: { claude: true, opencode: true } }),
      forebayDir: "/store",
      appHome: (app) => (app === "claude" ? "/home/claude/.claude" : "/home/opencode"),
      managesPlugins: (dir) => dir.replaceAll("\\", "/").includes("/.claude"),
    });
    expect(homes.find((h) => h.id === "forebay")?.managesPlugins).toBe(false);
    expect(homes.find((h) => h.id === "claude")?.managesPlugins).toBe(true);
    expect(homes.find((h) => h.id === "opencode")?.managesPlugins).toBe(false);
  });

  // The app list offers a home as an install target only when its loader can load what lands there.
  it("reports whether each app's own loader is installed", async () => {
    writeFileSync(process.env.HUB_APPS_FILE!, JSON.stringify({
      claude: { ...claudeApp, loader: { id: "claude-code-loader", url: "https://example.test/claude-code-loader" } },
      opencode: { ...opencodeApp, loader: { id: "opencode-loader", url: "https://example.test/opencode-loader" } },
    }));
    const homes = await pluginHomes({
      detect: async () => ({ ok: true, data: { claude: true, opencode: true } }),
      forebayDir: "/store",
      appHome: (app) => "/home/" + app,
      managesPlugins: () => true,
      hasLoader: (dir, loaderId) => !!loaderId && dir === "/home/claude",
    });
    expect(homes.find((h) => h.id === "claude")?.loaderInstalled).toBe(true);
    expect(homes.find((h) => h.id === "opencode")?.loaderInstalled).toBe(false);
    // Forebay has no loader to install, so it never claims one.
    expect(homes.find((h) => h.id === "forebay")?.loaderInstalled).toBeUndefined();
  });
});

describe("homeById", () => {
  // A shared lookup every module resolving a home id (screens, config, providers) relies
  // on to reject an id nothing carries rather than silently proceeding with `undefined`.
  it("throws for a home id nothing in the list carries", () => {
    const homes = [{ id: "app-a", label: "App A", dir: "/homes/a", present: true, managesPlugins: true }];
    expect(() => homeById("nope", homes)).toThrow("unknown plugin home: nope");
  });
});

describe("loaderInstalled", () => {
  it("is false for a home whose app declares no loader", async () => {
    expect(await loaderInstalled("/home/x", undefined, async () => [{ name: "anything" }] as never)).toBe(false);
  });

  it("is true only when the home lists that exact loader", async () => {
    const list = async () => [{ id: "opencode-loader" }, { id: "wakatime-sync" }];
    expect(await loaderInstalled("/home/o", "opencode-loader", "opencode", list)).toBe(true);
    expect(await loaderInstalled("/home/o", "claude-code-loader", "opencode", list)).toBe(false);
  });

  // A home we cannot read is not evidence of an install, and must not throw into the caller.
  it("reads an unreadable home as not installed", async () => {
    expect(await loaderInstalled("/gone", "opencode-loader", "opencode", () => { throw new Error("ENOENT"); })).toBe(false);
  });
});
