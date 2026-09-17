import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { ECOSYSTEM_ORG, getConfigValue } from "@intisy-ai/basekit";
import { scanOrg, type OrgScanDeps } from "./orgScan.js";
import type {
  CatalogEntry,
  CatalogKind,
  CatalogResult,
  MarketplaceSource,
  MarketplaceSourceStatus,
  ShadowedEntry,
} from "../../../packages/shared/src/domain.js";

const CONFIG_NAME = "marketplaces";
const KINDS: CatalogKind[] = ["provider", "proxy", "plugin", "loader", "translator"];

export interface MarketplaceDeps extends OrgScanDeps {
  sources?: MarketplaceSource[];
  readFileFn?: (path: string) => Promise<string>;
}

// The one source every home starts with. Kept as a github-org source rather than a special
// case so the built-in marketplace goes through exactly the same path as an added one, and
// the existing forebay.marketplaceOrg setting keeps choosing which org that is.
export function builtInSource(): MarketplaceSource {
  const configured = getConfigValue("forebay", "marketplaceOrg");
  const org = typeof configured === "string" && configured.trim() ? configured.trim() : ECOSYSTEM_ORG;
  return { id: org, label: org, type: "github-org", org };
}

function validSource(raw: unknown): MarketplaceSource | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const type = source.type;
  if (!id || (type !== "github-org" && type !== "manifest" && type !== "local")) return null;
  if (type === "github-org" && typeof source.org !== "string") return null;
  if (type === "manifest" && typeof source.url !== "string") return null;
  if (type === "local" && typeof source.path !== "string") return null;
  return {
    id,
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : id,
    type,
    enabled: source.enabled !== false,
    org: typeof source.org === "string" ? source.org : undefined,
    url: typeof source.url === "string" ? source.url : undefined,
    path: typeof source.path === "string" ? source.path : undefined,
  };
}

// An entry that names no id, or no location for its type, is dropped rather than guessed at:
// a half-declared source would fail on every scan with a reason that names the config rather
// than the marketplace. Anything left empty means "just the built-in marketplace", so a home
// that has never configured one behaves exactly as before.
export function parseSources(raw: unknown): MarketplaceSource[] {
  if (!Array.isArray(raw)) return [builtInSource()];
  const sources = raw.map(validSource).filter((s): s is MarketplaceSource => s !== null);
  return sources.length > 0 ? sources : [builtInSource()];
}

export function resolveSources(deps: MarketplaceDeps = {}): MarketplaceSource[] {
  return deps.sources ?? parseSources(getConfigValue(CONFIG_NAME, "sources"));
}

function parseEntries(raw: unknown, sourceId: string): CatalogEntry[] {
  const manifest = raw as { entries?: unknown };
  if (!Array.isArray(manifest?.entries)) throw new Error("no entries array");
  const entries: CatalogEntry[] = [];
  for (const candidate of manifest.entries) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    const kind = entry.kind as CatalogKind;
    if (!name || !url || !KINDS.includes(kind)) continue;
    entries.push({
      name,
      url,
      kind,
      description: typeof entry.description === "string" ? entry.description : "",
      deprecated: entry.deprecated === true,
      topics: Array.isArray(entry.topics) ? (entry.topics as unknown[]).filter((t): t is string => typeof t === "string") : [],
      displayName: typeof entry.displayName === "string" ? entry.displayName : undefined,
      sourceId,
    });
  }
  return entries;
}

async function readManifestSource(source: MarketplaceSource, deps: MarketplaceDeps): Promise<CatalogEntry[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const response = await fetchFn(source.url as string, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`http ${response.status}`);
  return parseEntries(await response.json(), source.id);
}

async function readLocalSource(source: MarketplaceSource, deps: MarketplaceDeps): Promise<CatalogEntry[]> {
  const read = deps.readFileFn ?? ((path: string) => readFile(path, "utf8"));
  const base = source.path as string;
  const file = base.endsWith(".json") ? base : join(base, "marketplace.json");
  if (!isAbsolute(file)) throw new Error("a local marketplace needs an absolute path");
  return parseEntries(JSON.parse(await read(file)), source.id);
}

async function readSource(source: MarketplaceSource, deps: MarketplaceDeps): Promise<{ entries: CatalogEntry[]; org: CatalogResult["source"] | null; result?: CatalogResult }> {
  if (source.type === "github-org") {
    const result = await scanOrg({ ...deps, getOrg: () => source.org as string });
    return { entries: result.entries.map((entry) => ({ ...entry, sourceId: source.id })), org: result.source, result };
  }
  const entries = source.type === "manifest" ? await readManifestSource(source, deps) : await readLocalSource(source, deps);
  return { entries, org: null };
}

// Reads every configured marketplace concurrently and merges them. A source that throws
// contributes its reason to `sources` and nothing to `entries`: an unreachable marketplace
// must never read as an empty catalog, which is what a single-source scan did.
//
// Two marketplaces can publish the same name. Config order is precedence, so the first
// source to claim a name keeps it and later ones are skipped rather than rendering twice
// under one key. Each skip is recorded against the losing source: dropping an entry the user
// can see in a marketplace, with no sign of why, is the kind of silence this whole file exists
// to remove.
export async function scanMarketplaces(deps: MarketplaceDeps = {}): Promise<CatalogResult> {
  const configured = resolveSources(deps).filter((source) => source.enabled !== false);

  const read = await Promise.all(configured.map(async (source) => {
    try {
      return { source, ...(await readSource(source, deps)) };
    } catch (e) {
      return { source, entries: [] as CatalogEntry[], org: null, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  const entries: CatalogEntry[] = [];
  const claimedBy = new Map<string, string>();
  const sources: MarketplaceSourceStatus[] = [];
  for (const outcome of read) {
    const fresh: CatalogEntry[] = [];
    const shadowed: ShadowedEntry[] = [];
    for (const entry of outcome.entries) {
      const winner = claimedBy.get(entry.name);
      if (winner) shadowed.push({ name: entry.name, by: winner });
      else fresh.push(entry);
    }
    for (const entry of fresh) claimedBy.set(entry.name, outcome.source.label);
    entries.push(...fresh);
    const error = (outcome as { error?: string }).error;
    sources.push({
      id: outcome.source.id,
      label: outcome.source.label,
      type: outcome.source.type,
      ok: !error,
      entryCount: fresh.length,
      error,
      shadowed: shadowed.length > 0 ? shadowed : undefined,
    });
  }

  // The token source and rate-limit flag describe the GitHub read specifically, so they come
  // from the first github-org source rather than being invented for a manifest.
  const orgOutcome = read.find((outcome) => outcome.source.type === "github-org");
  const orgResult = (orgOutcome as { result?: CatalogResult } | undefined)?.result;
  return {
    entries,
    source: orgResult?.source ?? "anonymous",
    org: orgOutcome?.source.org ?? "",
    rateLimited: orgResult?.rateLimited ?? false,
    sources,
  };
}
