import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfigDir } from "@intisy-ai/basekit/auth";
import { cacheDir } from "./storagePaths.js";

// A generic, persistent, namespaced key/value cache for anything Forebay wants to
// show instantly on load and refresh in the background: plugin versions, repo
// stars/readmes, and whatever comes next. Entries are opaque JSON keyed by
// (namespace, key); callers own the shape. Best-effort: a read or write failure
// never throws, it just degrades to a cache miss.

export type CacheEntry<T> = { value: T; at: number };
type CacheFile = Record<string, Record<string, CacheEntry<unknown>>>;

// Keyed by resolved file path so multiple config dirs (e.g. tests) stay isolated.
const memory = new Map<string, CacheFile>();

function cachePath(configDir: string): string {
  return join(cacheDir(configDir), "forebay-cache.json");
}

function load(configDir: string): CacheFile {
  const path = cachePath(configDir);
  const hit = memory.get(path);
  if (hit) return hit;
  let data: CacheFile = {};
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
      if (parsed && typeof parsed === "object") data = parsed;
    }
  } catch {
    data = {};
  }
  memory.set(path, data);
  return data;
}

function persist(configDir: string, data: CacheFile): void {
  const path = cachePath(configDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    // Write to a temp file then rename: a rename is atomic, so a crash or a
    // concurrent read can never observe a half-written (unparseable) cache file,
    // which would otherwise wipe every entry on the next load.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, path);
  } catch {
    // best-effort: an unwritable cache just means the next load is a miss
  }
}

function set<T>(configDir: string, namespace: string, key: string, value: T, at: number): boolean {
  const data = load(configDir);
  const ns = (data[namespace] ??= {});
  if (ns[key] && JSON.stringify(ns[key].value) === JSON.stringify(value)) return false;
  ns[key] = { value, at };
  return true;
}

export function readCache<T>(namespace: string, key: string, configDir: string = getConfigDir()): CacheEntry<T> | null {
  if (!configDir) return null;
  const entry = load(configDir)[namespace]?.[key];
  return entry ? { value: entry.value as T, at: entry.at } : null;
}

export function readNamespace<T>(namespace: string, configDir: string = getConfigDir()): Record<string, CacheEntry<T>> {
  if (!configDir) return {};
  return (load(configDir)[namespace] ?? {}) as Record<string, CacheEntry<T>>;
}

// Writes only when the value actually changed, so an unchanged background refresh
// neither rewrites the file nor bumps timestamps. Returns whether anything changed.
export function writeCache<T>(namespace: string, key: string, value: T, configDir: string = getConfigDir(), at: number = Date.now()): boolean {
  if (!configDir) return false;
  const changed = set(configDir, namespace, key, value, at);
  if (changed) persist(configDir, load(configDir));
  return changed;
}

// Writes a whole namespace's worth of entries with a single persist, so refreshing
// N plugins' versions is one file write instead of N. Returns whether anything changed.
export function writeCacheMany<T>(namespace: string, entries: Record<string, T>, configDir: string = getConfigDir(), at: number = Date.now()): boolean {
  if (!configDir) return false;
  let changed = false;
  for (const [key, value] of Object.entries(entries)) changed = set(configDir, namespace, key, value, at) || changed;
  if (changed) persist(configDir, load(configDir));
  return changed;
}

export function dropCache(namespace: string, key: string, configDir: string = getConfigDir()): void {
  if (!configDir) return;
  const ns = load(configDir)[namespace];
  if (ns && key in ns) {
    delete ns[key];
    persist(configDir, load(configDir));
  }
}

export function resetCacheForTests(): void {
  memory.clear();
}
