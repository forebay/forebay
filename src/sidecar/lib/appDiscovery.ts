import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getApps, registerApp, resolveHome, DEFAULT_PATH_NAMES, appPaths } from "@intisy-ai/basekit";
import type { AppDescriptor } from "@intisy-ai/basekit";
import { scanOrg } from "./orgScan.js";
import type { OrgScanDeps } from "./orgScan.js";
import type { CatalogResult } from "../../../packages/shared/src/domain.js";

export interface AppDiscoveryDeps {
  scanOrgFn?: (deps?: OrgScanDeps) => Promise<CatalogResult>;
  orgScanDeps?: OrgScanDeps;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  getAppsFn?: () => AppDescriptor[];
  registerAppFn?: (desc: AppDescriptor) => void;
}

// Normalisation exists only so two descriptors carrying the same data compare equal, so it fills
// the fields that have defaults and passes everything else through untouched. A descriptor
// differing only in a trait this function has not heard of must never compare equal.
function normalizeDescriptor(desc: AppDescriptor): AppDescriptor {
  return {
    ...desc,
    detect: { binary: desc.detect?.binary ?? desc.id, pkg: desc.detect?.pkg ?? "" },
    commandsSubdir: desc.commandsSubdir ?? "commands",
    paths: { ...DEFAULT_PATH_NAMES, ...desc.paths },
    proxyPort: desc.proxyPort ?? 0,
    integration: desc.integration ?? "env-baseurl",
    // Not core's actual wireFormat default (an arbitrary wire-format id, never hardcoded here):
    // only used so two descriptors missing the field compare equal.
    wireFormat: desc.wireFormat ?? "",
  };
}

// Recursively sorts object keys before stringifying, so two descriptors that
// carry the same data in a different key order still compare equal.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) sorted[k] = (val as Record<string, unknown>)[k];
      return sorted;
    }
    return val;
  });
}

function sameDescriptor(a: AppDescriptor, b: AppDescriptor): boolean {
  return stableStringify(normalizeDescriptor(a)) === stableStringify(normalizeDescriptor(b));
}

// The descriptor holds its mark as a raw SVG; the org-scan catalog carries the
// loader's icon.svg as a rendered data URI, so decode it back to the raw form.
function rawSvgFromDataUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const base64 = uri.match(/^data:image\/svg\+xml;base64,(.*)$/s);
  if (base64) {
    try { return Buffer.from(base64[1], "base64").toString("utf-8"); } catch { return undefined; }
  }
  const inline = uri.match(/^data:image\/svg\+xml(?:;[^,]*)?,(.*)$/s);
  if (inline) {
    try { return decodeURIComponent(inline[1]); } catch { return inline[1]; }
  }
  return undefined;
}

// A loader's installed clone carries its `app` block in the same
// "repos/<loaderId>/plugin.json" the sidecar already reads plugin manifests from
// (see plugins.ts's readManifest). Undefined when the clone declares no app
// block, in which case the org-scan descriptor still stands.
function readInstalledAppBlock(dir: string, exists: (p: string) => boolean, readFile: (p: string) => string): AppDescriptor | undefined {
  const manifestPath = join(dir, "plugin.json");
  if (!exists(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(readFile(manifestPath)) as { app?: unknown };
    if (manifest.app && typeof manifest.app === "object" && !Array.isArray(manifest.app)) return manifest.app as AppDescriptor;
  } catch {
    // malformed manifest on disk, skip this source
  }
  return undefined;
}

// The loader's icon.svg (a raw square SVG, the app's mark) sits beside its
// manifest in the clone and is present even when an older clone lacks the app
// block, so the registry carries the icon offline with no org-scan or token.
function readInstalledIcon(dir: string, exists: (p: string) => boolean, readFile: (p: string) => string): string | undefined {
  const iconPath = join(dir, "icon.svg");
  if (!exists(iconPath)) return undefined;
  try { return readFile(iconPath); } catch { return undefined; }
}

// Populates ~/.config/forebay/apps.json from two best-effort sources: the org-scan
// catalog's loader manifests (app block + the loader's published icon), and the
// installed loader clone (a fresher app block when present, and its icon.svg for
// offline icons). Never throws; each source degrades independently, and an
// unchanged descriptor is never rewritten so steady-state calls touch no disk.
export async function discoverApps(deps: AppDiscoveryDeps = {}): Promise<void> {
  const scan = deps.scanOrgFn ?? scanOrg;
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const getAppsFn = deps.getAppsFn ?? getApps;
  const registerAppFn = deps.registerAppFn ?? registerApp;

  const current = getAppsFn();
  const candidates = new Map<string, AppDescriptor>();

  try {
    const catalog = await scan(deps.orgScanDeps);
    for (const entry of catalog.entries) {
      if (entry.kind !== "loader" || !entry.app) continue;
      const icon = entry.app.icon ?? rawSvgFromDataUri(entry.icon);
      candidates.set(entry.app.id, icon ? { ...entry.app, icon } : entry.app);
    }
  } catch {
    // org-scan source unavailable, fall through to the installed-loader source
  }

  // Overlay each loader-bearing descriptor with what its installed clone provides:
  // a fresher app block if the clone carries one, and the loader's own icon.svg.
  const withLoader = new Map<string, AppDescriptor>();
  for (const desc of [...current, ...candidates.values()]) if (desc.loader) withLoader.set(desc.id, desc);
  for (const desc of withLoader.values()) {
    try {
      const dir = join(appPaths(resolveHome(desc), desc).repos, desc.loader!.id);
      const block = readInstalledAppBlock(dir, exists, readFile);
      const icon = readInstalledIcon(dir, exists, readFile);
      const merged: AppDescriptor = { ...(candidates.get(desc.id) ?? desc), ...(block ?? {}) };
      if (icon) merged.icon = icon;
      candidates.set(merged.id, merged);
    } catch {
      // best-effort per app, never blocks discovery of the others
    }
  }

  for (const desc of candidates.values()) {
    const existing = current.find((a) => a.id === desc.id);
    if (existing && sameDescriptor(existing, desc)) continue;
    try {
      registerAppFn(desc);
    } catch {
      // an invalid candidate descriptor is skipped, not fatal to discovery
    }
  }
}
