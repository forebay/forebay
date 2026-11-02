import type { CatalogKind, MarketplaceContribution } from "./domain.js";

export type RepoRef = { owner: string; repo: string; url: string };

const GH_URL = /^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;
const SHORT = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;

export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = GH_URL.exec(trimmed) ?? SHORT.exec(trimmed);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export function classifyRepoName(name: string): CatalogKind | null {
  if (name.startsWith("core-")) return null;
  if (name.endsWith("-translator")) return "translator";
  if (name.endsWith("-loader")) return "host";
  if (name.endsWith("-proxy")) return "proxy";
  if (name.endsWith("-auth")) return "provider";
  return "plugin";
}

// Classify a repo by its GitHub category topic (the single category tag every
// org repo carries via repo-metadata). A repo with none of the installable
// category topics is not a marketplace entry, so it is left out entirely.
// This is stricter than name-matching, which had a catch-all that swept in
// every untagged repo.
export function classifyRepoTopics(topics: string[]): CatalogKind | null {
  if (topics.includes("ai-provider")) return "provider";
  if (topics.includes("app-proxy")) return "proxy";
  if (topics.includes("app-loader") || topics.includes("app-host")) return "host";
  if (topics.includes("vendor-translator")) return "translator";
  if (topics.includes("plugin")) return "plugin";
  return null;
}

export const MARKETPLACE_METHOD = "marketplace";

export function withMarketplaceMethod(methods: string[] | undefined): string[] {
  const declared = methods ?? [];
  return declared.includes(MARKETPLACE_METHOD) ? declared : [MARKETPLACE_METHOD, ...declared];
}

// Whether an entry belongs to a plugin-contributed category. Structural on purpose: the
// sidecar asks with a CatalogEntry and the renderer with a UnifiedPlugin, and both carry the
// only two things a match can name.
export function matchesContribution(entry: { kind: CatalogKind; topics: string[] }, contribution: MarketplaceContribution): boolean {
  const { topics, kind } = contribution.match;
  if (kind && entry.kind !== kind) return false;
  if (topics && !topics.some((topic) => entry.topics.includes(topic))) return false;
  return true;
}
