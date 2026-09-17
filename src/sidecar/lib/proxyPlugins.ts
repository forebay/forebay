import { statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getConfigDir } from "@intisy-ai/basekit/auth";
import { getAppDescriptor } from "@intisy-ai/basekit";
import type { RoutingProfile } from "@intisy-ai/basekit/proxy";
import { pluginProvidesCapability, unmanifestedPlugins } from "./capabilityOwner.js";
import { listedPlugins } from "./pluginManager.js";
import { reposDir } from "./storagePaths.js";

// These read the dashboard's own store, so the capability is resolved against this app's own home.
const OWN_APP = "forebay";

export type LoadedProxyDef = { app: string; label: string; profile: () => RoutingProfile; setup?: string };

function isProxyDef(x: unknown): x is LoadedProxyDef {
  const d = x as LoadedProxyDef | undefined;
  if (!d || typeof d.app !== "string" || !getAppDescriptor(d.app) || typeof d.label !== "string" || typeof d.profile !== "function") return false;
  return d.setup === undefined || typeof d.setup === "string";
}

const cache = new Map<string, { mtimeMs: number; def: LoadedProxyDef | null }>();
export function resetProxyDefCacheForTests(): void {
  cache.clear();
}

export interface ProxyPluginsDeps {
  importFn?: (url: string) => Promise<unknown>;
  listPlugins?: (storeDir: string, appId: string) => Promise<{ id: string; enabled?: boolean }[]>;
  providesFrontDoor?: (storeDir: string, pluginName: string) => boolean;
}

export type InstalledProxy = { name: string; enabled: boolean; def: LoadedProxyDef | null };

async function loadProxyDef(storeDir: string, name: string, importFn: (url: string) => Promise<unknown>): Promise<LoadedProxyDef | null> {
  const distPath = join(reposDir(storeDir), name, "dist", "index.js");
  let mtimeMs: number;
  try {
    mtimeMs = statSync(distPath).mtimeMs;
  } catch {
    return null;
  }
  const cached = cache.get(distPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.def;
  let def: LoadedProxyDef | null = null;
  try {
    const mod = (await importFn(pathToFileURL(distPath).href + "?v=" + mtimeMs)) as { proxyDef?: unknown };
    if (isProxyDef(mod.proxyDef)) def = mod.proxyDef;
  } catch {
    def = null;
  }
  cache.set(distPath, { mtimeMs, def });
  return def;
}

export async function listInstalledProxies(storeDir: string = getConfigDir(), deps: ProxyPluginsDeps = {}): Promise<InstalledProxy[]> {
  const importFn = deps.importFn ?? ((url: string) => import(/* @vite-ignore */ url));
  const listPlugins = deps.listPlugins ?? listedPlugins;
  const providesFrontDoor = deps.providesFrontDoor ?? ((dir: string, pluginName: string) => pluginProvidesCapability(dir, pluginName, "front-door"));
  const proxies: InstalledProxy[] = [];
  for (const plugin of await listPlugins(storeDir, OWN_APP)) {
    if (!providesFrontDoor(storeDir, plugin.id)) continue;
    const def = await loadProxyDef(storeDir, plugin.id, importFn);
    proxies.push({ name: plugin.id, enabled: plugin.enabled !== false, def });
  }
  return proxies;
}

export async function loadInstalledProxyDefs(storeDir: string = getConfigDir(), deps: ProxyPluginsDeps = {}): Promise<LoadedProxyDef[]> {
  const proxies = await listInstalledProxies(storeDir, deps);
  const defs: LoadedProxyDef[] = [];
  for (const proxy of proxies) {
    if (proxy.def) defs.push(proxy.def);
  }
  return defs;
}

/**
 * Installed plugin names with a deployed bundle but no manifest anywhere, so a caller that found
 * no proxy can tell "nothing installed" from "something is installed but unreadable".
 */
export async function unresolvedProxyPlugins(storeDir: string = getConfigDir(), deps: ProxyPluginsDeps = {}): Promise<string[]> {
  const listPlugins = deps.listPlugins ?? listedPlugins;
  const names = (await listPlugins(storeDir, OWN_APP)).map((plugin) => plugin.id);
  return unmanifestedPlugins(storeDir, names);
}
