import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readDeployedManifests } from "@intisy/bayonet/host";
import { configNameFor } from "@intisy-ai/basekit";
import type { PluginManifest } from "@intisy/bayonet";
import { pluginDir, reposDir } from "./storagePaths.js";

/** One plugin deployed in a home, as its manifest sidecar describes it. */
export interface DeployedManifest {
  /** The manifest id, which is also the bundle and sidecar basename. */
  id: string;
  /** Capability ids the manifest declares. */
  capabilities: string[];
  /** Permissions the manifest declares. */
  permissions: string[];
  /** The file this plugin's settings live in, `config/<configName>.json`, which is the id unless the manifest renames it. */
  configName: string;
  /** Every setting the manifest declares and what it is worth until a home changes it, or null when it declares none. */
  configDefaults: Record<string, unknown> | null;
  /** Paths the manifest declares this plugin writes to, beyond the ones named after it. */
  dataPaths: string[];
  /** The deployed bundle beside the sidecar, or null when none is deployed. */
  entryPath: string | null;
}

/**
 * Every plugin deployed in one home, ordered by id.
 *
 * @remarks
 * Reads the sidecars deploy writes beside each bundle, so it answers without importing anything and
 * without a running host. An unreadable home is an empty list rather than a throw: Forebay renders
 * several homes at once and one broken home must not blank the others.
 */
export function deployedManifests(homeDir: string): DeployedManifest[] {
  try {
    return readDeployedManifests(pluginDir(homeDir)).loaded.map((plugin) => ({
      id: plugin.manifest.id,
      capabilities: plugin.manifest.capabilities ?? [],
      permissions: plugin.manifest.permissions ?? [],
      configName: configNameFor(plugin.manifest),
      configDefaults: plugin.manifest.config?.defaults ?? null,
      dataPaths: plugin.manifest.data?.paths ?? [],
      entryPath: plugin.entryPath,
    }));
  } catch {
    return [];
  }
}

/**
 * One npm plugin's own manifest, read from the package its entry file lives in.
 *
 * @remarks
 * An npm plugin deploys no bundle and writes no sidecar, so `deployedManifests` cannot see it at
 * all. Its package still carries the same `plugin.json`, which is what keeps its settings reachable
 * without running it. Null when the package has none or it cannot be read.
 */
export function npmPackageManifest(entryPath: string): DeployedManifest | null {
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(entryPath), "..", "plugin.json"), "utf-8")) as PluginManifest;
    if (typeof manifest?.id !== "string" || !manifest.id) return null;
    return {
      id: manifest.id,
      capabilities: manifest.capabilities ?? [],
      permissions: manifest.permissions ?? [],
      configName: configNameFor(manifest),
      configDefaults: manifest.config?.defaults ?? null,
      dataPaths: manifest.data?.paths ?? [],
      entryPath,
    };
  } catch {
    return null;
  }
}

interface CloneManifest {
  id: string;
  capabilities: string[];
}

/**
 * A clone's own `plugin.json`, read directly from `<reposDir(home)>/<repo>/plugin.json` rather than
 * from a deployed sidecar.
 *
 * @remarks
 * A home deployed before manifest sidecars existed has bundles with no sidecar beside them, which
 * `deployedManifests` cannot see at all. The clone itself still carries the same `plugin.json` the
 * deploy step would have copied, so reading it here is what still resolves identity and capabilities
 * for a home whose clones are current, even though its deployed sidecars are not.
 */
function cloneManifest(repo: string, homeDir: string): CloneManifest | null {
  try {
    const raw = JSON.parse(readFileSync(join(reposDir(homeDir), repo, "plugin.json"), "utf-8")) as { id?: unknown; capabilities?: unknown };
    const id = typeof raw.id === "string" && raw.id ? raw.id : repo;
    const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.filter((c): c is string => typeof c === "string") : [];
    return { id, capabilities };
  } catch {
    return null;
  }
}

function listClones(homeDir: string): string[] {
  try {
    return readdirSync(reposDir(homeDir), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** The plugin id a clone directory's own `plugin.json` declares, or the directory name when the clone's `plugin.json` is absent, unreadable, or declares none. */
export function pluginIdFromClone(repo: string, homeDir: string): string {
  return cloneManifest(repo, homeDir)?.id ?? repo;
}

/**
 * The plugin providing a capability in this home, or null when nothing declares it.
 *
 * @remarks
 * A deployed sidecar answers first; a clone's own `plugin.json` is the fallback for a plugin
 * deployed before sidecars existed (see `cloneManifest`).
 */
export function ownerOfCapability(homeDir: string, capabilityId: string): string | null {
  const deployed = deployedManifests(homeDir).find((plugin) => plugin.capabilities.includes(capabilityId));
  if (deployed) return deployed.id;
  for (const repo of listClones(homeDir)) {
    const manifest = cloneManifest(repo, homeDir);
    if (manifest?.capabilities.includes(capabilityId)) return manifest.id;
  }
  return null;
}

/** Whether one named plugin declares a capability in this home, checking its deployed sidecar and then its clone's own `plugin.json`. */
export function pluginProvidesCapability(homeDir: string, pluginId: string, capabilityId: string): boolean {
  if (deployedManifests(homeDir).some((plugin) => plugin.id === pluginId && plugin.capabilities.includes(capabilityId))) return true;
  return cloneManifest(pluginId, homeDir)?.capabilities.includes(capabilityId) ?? false;
}

/** Whether a plugin is deployed in this home at all, whatever a home's plugin list says. */
export function isDeployedPlugin(homeDir: string, pluginId: string): boolean {
  return deployedManifests(homeDir).some((plugin) => plugin.id === pluginId);
}

function deployedBundleNames(homeDir: string): string[] {
  try {
    return readdirSync(pluginDir(homeDir)).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

/**
 * Names, among the ones a home's plugin list declares installed, that have a deployed bundle but
 * no manifest from either source: no deployed sidecar, and no readable `plugin.json` in the clone.
 *
 * @remarks
 * `readDeployedManifests` enumerates `.json` sidecars, so a bundle with none beside it is not
 * `loaded` and not `failed`, simply absent from its answer. This is what still names the gap, so a
 * home stuck on a pre-sidecar deploy reads as "needs an update" rather than as nothing installed.
 */
export function unmanifestedPlugins(homeDir: string, installedNames: string[]): string[] {
  const bundled = new Set(deployedBundleNames(homeDir));
  return installedNames.filter((name) => bundled.has(name) && !existsSync(join(pluginDir(homeDir), `${name}.json`)) && !cloneManifest(name, homeDir));
}
