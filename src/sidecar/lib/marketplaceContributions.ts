import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalogKind, MarketplaceContribution } from "../../../packages/shared/src/domain.js";

export interface ContributionDeps {
  reposDir?: string;
  listRepos?: (dir: string) => string[];
  readManifest?: (path: string) => string | null;
}

function readOrNull(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function listRepoNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function validMatch(raw: unknown): MarketplaceContribution["match"] | null {
  if (!raw || typeof raw !== "object") return null;
  const match = raw as Record<string, unknown>;
  const topics = Array.isArray(match.topics) ? (match.topics as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const kind = typeof match.kind === "string" ? (match.kind as CatalogKind) : undefined;
  if (topics.length === 0 && !kind) return null;
  return { topics: topics.length > 0 ? topics : undefined, kind };
}

function contributionsFrom(raw: unknown, plugin: string): MarketplaceContribution[] {
  const manifest = raw as { marketplace?: { categories?: unknown } };
  const declared = manifest?.marketplace?.categories;
  if (!Array.isArray(declared)) return [];
  const out: MarketplaceContribution[] = [];
  for (const candidate of declared) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const match = validMatch(entry.match);
    if (!id || !match) continue;
    out.push({
      id,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : id,
      match,
      contributedBy: plugin,
    });
  }
  return out;
}

// Categories a plugin adds to the marketplace, declared in its own manifest.
//
// A contribution states a MATCH, never a list of entries. That is what keeps it dynamic: a
// translator published tomorrow carries the topic the category matches and appears with no
// change to the plugin that declared the category, and no plugin code runs when the
// marketplace opens. Forebay holds no plugin identity of its own either way; it renders
// whatever the installed manifests declare.
export function readMarketplaceContributions(deps: ContributionDeps = {}): MarketplaceContribution[] {
  const dir = deps.reposDir;
  if (!dir) return [];
  const list = deps.listRepos ?? listRepoNames;
  const read = deps.readManifest ?? readOrNull;

  const out: MarketplaceContribution[] = [];
  const claimed = new Set<string>();
  for (const plugin of list(dir)) {
    const source = read(join(dir, plugin, "plugin.json"));
    if (!source) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    for (const contribution of contributionsFrom(parsed, plugin)) {
      // Two plugins asking for the same category id get one category, not a duplicate chip.
      if (claimed.has(contribution.id)) continue;
      claimed.add(contribution.id);
      out.push(contribution);
    }
  }
  return out;
}
