import { appIdForHome, getAppDescriptor, appPaths } from "@intisy-ai/basekit";
import type { AppPaths } from "@intisy-ai/basekit";

// The storage directories for one app home. Forebay manages several homes at once
// and is handed a directory rather than an app id, so the owning app is looked up
// from the directory; a home no app claims falls back to the conventional names.
export function pathsForHome(homeDir: string): AppPaths {
  const id = appIdForHome(homeDir);
  return appPaths(homeDir, id ? getAppDescriptor(id) ?? null : null);
}

export function reposDir(homeDir: string): string {
  return pathsForHome(homeDir).repos;
}

export function pluginDir(homeDir: string): string {
  return pathsForHome(homeDir).plugin;
}

export function cacheDir(homeDir: string): string {
  return pathsForHome(homeDir).cache;
}
