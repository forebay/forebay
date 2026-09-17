import { catalogFor, queryCapability } from "@intisy-ai/basekit/loader/capability-catalog.js";
import type { CatalogDeps, CatalogEntry } from "@intisy-ai/basekit/loader/capability-catalog.js";
import { readMarketplaceSources, builtInSource } from "@intisy-ai/basekit/loader/catalog-sources.js";
import type { MarketplaceSource } from "@intisy-ai/basekit/loader/catalog-sources.js";
import { pathsForHome } from "./storagePaths.js";
import { resolveToken } from "./orgScan.js";

export type { CatalogEntry };

/** How long a home's fetched catalog stands before it is read again. */
const CATALOG_WINDOW_MS = 3_600_000;

// basekit/loader's own homePaths derives its subdirectory names from the ACTIVE home's environment
// overrides, which is wrong for a dashboard reading three foreign homes at once. pathsForHome looks
// the owning app up from the directory instead, so each home answers with its own names.
function pathsOf(homeDir: string) {
  const paths = pathsForHome(homeDir);
  return {
    configDir: homeDir,
    reposDir: paths.repos,
    pluginDir: paths.plugin,
    cacheDir: paths.cache,
    configFolder: paths.config,
  };
}

/**
 * A GitHub read carrying whatever credential this machine has connected.
 *
 * @remarks
 * basekit/loader's own default sends a User-Agent and nothing else, so every catalog build queried
 * GitHub anonymously against its 60-per-hour budget while the marketplace list beside it used a
 * token. One catalog build fans a manifest read out across every repository in the org, so the
 * anonymous budget is exhausted by a single build and the capability lookup then answers "no plugin
 * provides this" instead of "GitHub refused me". Credential resolution belongs here rather than in
 * core-loader, which owns no accounts.
 */
function authenticatedFetchJson(): (url: string) => Promise<unknown> {
  return async (url: string) => {
    const { token } = await resolveToken(process.env, async () => "");
    try {
      const response = await fetch(url, {
        headers: token
          ? { "User-Agent": "forebay", Authorization: `Bearer ${token}` }
          : { "User-Agent": "forebay" },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  };
}

function withCredential(deps: CatalogDeps): CatalogDeps {
  return deps.fetchJson ? deps : { ...deps, fetchJson: authenticatedFetchJson() };
}

function sourcesOf(homeDir: string): MarketplaceSource[] {
  try {
    // readMarketplaceSources already falls back to [builtInSource()] when a home declares
    // none, so its result is never empty; only an unreadable home reaches the catch below.
    return readMarketplaceSources(pathsOf(homeDir));
  } catch {
    return [builtInSource()];
  }
}

/** Every repository the home's declared marketplace sources offer, from its cache while fresh. */
export async function catalogEntriesFor(homeDir: string, deps: CatalogDeps = {}): Promise<CatalogEntry[]> {
  try {
    return await catalogFor(sourcesOf(homeDir), pathsOf(homeDir), CATALOG_WINDOW_MS, withCredential(deps));
  } catch {
    return [];
  }
}

/**
 * The repository to install when a home needs a capability it has not got.
 *
 * @remarks
 * The answer comes from each candidate's own `plugin.json`, never from a GitHub topic: repo-meta
 * assigns exactly one category topic per repository, so a repository that is both a provider and a
 * proxy cannot be described by topics at all.
 */
export async function repoProvidingCapability(
  homeDir: string,
  capabilityId: string,
  deps: CatalogDeps = {},
): Promise<CatalogEntry | null> {
  try {
    const found = await queryCapability(capabilityId, sourcesOf(homeDir), pathsOf(homeDir), CATALOG_WINDOW_MS, withCredential(deps));
    return found[0] ?? null;
  } catch {
    return null;
  }
}
