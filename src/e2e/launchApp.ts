import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { _electron } from "@playwright/test";

const nodeRequire = createRequire(import.meta.url);
const dirName = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(dirName, "..", "..");

interface AppRegistryEntry {
  home?: { envOverride?: string; candidates?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export type AppRegistry = Record<string, AppRegistryEntry>;

export interface SandboxedApp {
  app: Awaited<ReturnType<typeof _electron.launch>>;
  env: Record<string, string>;
  tempDir: string;
  storeDir: string;
  appsFile: string;
  homeDirs: Record<string, string>;
  dispose: () => Promise<void>;
}

/**
 * @implNote The real registry has no built-in apps merged in (see `build()` in core/src/apps.ts),
 * so pointing HUB_APPS_FILE at a synthetic copy gives total control over which app homes Forebay sees.
 */
function readRealAppRegistry(): AppRegistry {
  const realAppsFile = join(homedir(), ".config", "forebay", "apps.json");
  if (!existsSync(realAppsFile)) return {};
  const parsed = JSON.parse(readFileSync(realAppsFile, "utf8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AppRegistry) : {};
}

function buildSyntheticRegistry(real: AppRegistry, homeDirs: Record<string, string>): AppRegistry {
  const synthetic: AppRegistry = {};
  for (const [id, entry] of Object.entries(real)) {
    synthetic[id] = { ...entry, home: { ...entry.home, candidates: [homeDirs[id]] } };
  }
  return synthetic;
}

function sanitizedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function requireBuiltMainEntry(): string {
  const mainEntry = join(repoRoot, "out", "main", "index.js");
  if (!existsSync(mainEntry)) {
    throw new Error(`Forebay is not built: missing ${mainEntry}. Run "npm run build" first.`);
  }
  return mainEntry;
}

export async function launchSandboxedApp(): Promise<SandboxedApp> {
  const mainEntry = requireBuiltMainEntry();
  const electronBinary = nodeRequire("electron") as unknown as string;

  const tempDir = mkdtempSync(join(tmpdir(), "forebay-e2e-"));
  const appDataDir = join(tempDir, "appdata");
  const storeDir = join(appDataDir, "intisy");
  const appsFile = join(tempDir, "apps.json");
  mkdirSync(appDataDir, { recursive: true });

  const realRegistry = readRealAppRegistry();
  const homeDirs: Record<string, string> = {};
  for (const id of Object.keys(realRegistry)) {
    const homeDir = join(tempDir, "homes", id);
    mkdirSync(homeDir, { recursive: true });
    homeDirs[id] = homeDir;
  }
  writeFileSync(appsFile, JSON.stringify(buildSyntheticRegistry(realRegistry, homeDirs), null, 2));

  const env = sanitizedEnv(process.env);
  env.APPDATA = appDataDir;
  env.HUB_APPS_FILE = appsFile;
  // Belt-and-braces: envOverride already wins inside resolveHome once HUB_APPS_FILE
  // points here, but setting it too means a real ambient env var can never leak through.
  for (const [id, entry] of Object.entries(realRegistry)) {
    const override = entry.home?.envOverride;
    if (typeof override === "string" && override) env[override] = homeDirs[id];
  }

  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [mainEntry, "--disable-gpu", "--force-prefers-reduced-motion"],
    env,
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await app.close().catch(() => {});
    rmSync(tempDir, { recursive: true, force: true });
  };

  return { app, env, tempDir, storeDir, appsFile, homeDirs, dispose };
}
