import { execFile } from "node:child_process";
import { svgIconDataUri } from "./pluginIcon.js";
import { classifyRepoTopics } from "../../../packages/shared/src/repoRef.js";
import type { CatalogEntry, CatalogResult } from "../../../packages/shared/src/domain.js";
import { ECOSYSTEM_ORG, getConfigValue } from "@intisy-ai/basekit";
import type { AppDescriptor } from "@intisy-ai/basekit";

const TTL_MS = 60_000;

interface RepoJson { name?: string; html_url?: string; description?: string | null; archived?: boolean; topics?: string[] }
interface Manifest { displayName?: string; icon?: string; app?: AppDescriptor; apps?: string[] }

let cache: { at: number; result: CatalogResult } | null = null;
const MANIFEST_TTL_MS = 1_800_000;
const manifestCache = new Map<string, { at: number; value: Manifest }>();
export function resetOrgScanCache(): void { cache = null; manifestCache.clear(); }

function tryExec(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// On win32 a binary may be a native .exe (gh) or an npm shim (.cmd); try the
// bare name first and only fall back to the .cmd suffix if that spawn fails.
export function realExec(file: string, args: string[]): Promise<string> {
  if (process.platform !== "win32") return tryExec(file, args);
  return tryExec(file, args).catch(() => tryExec(`${file}.cmd`, args));
}

export interface OrgScanDeps { fetchFn?: typeof fetch; execFn?: (file: string, args: string[]) => Promise<string>; env?: NodeJS.ProcessEnv; now?: () => number; getOrg?: () => string }

function resolveOrg(getOrg?: () => string): string {
  if (getOrg) return getOrg();
  const configured = getConfigValue("forebay", "marketplaceOrg");
  return typeof configured === "string" && configured.trim() ? configured.trim() : ECOSYSTEM_ORG;
}

interface StoredGithubAccount { login: string; token: string }

// Reads the stored multi-account list and returns the active account's token: the
// account whose login matches githubActiveLogin, else the first stored account. With
// no accounts stored, falls back to the legacy single githubToken config value so an
// older config keeps working.
export function activeGithubToken(): string | null {
  const accounts = getConfigValue("forebay", "githubAccounts");
  if (Array.isArray(accounts) && accounts.length > 0) {
    const list = accounts as StoredGithubAccount[];
    const activeLogin = getConfigValue("forebay", "githubActiveLogin");
    const active = typeof activeLogin === "string" ? list.find((a) => a.login === activeLogin) : undefined;
    return (active ?? list[0]).token?.trim() || null;
  }
  const legacy = getConfigValue("forebay", "githubToken");
  return typeof legacy === "string" && legacy.trim() ? legacy.trim() : null;
}

// Never falls back to the local gh CLI: a token is only used once the user has
// explicitly connected a GitHub account (env var or a stored account). The gh CLI
// is merely detected elsewhere (resolveGhCli) to offer a one-click connect prompt.
export async function resolveToken(env: NodeJS.ProcessEnv, _execFn: (f: string, a: string[]) => Promise<string>): Promise<{ token: string | null; source: CatalogResult["source"] }> {
  const envToken = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (envToken) return { token: envToken, source: "env" };
  const configToken = activeGithubToken();
  if (configToken) return { token: configToken, source: "config" };
  return { token: null, source: "anonymous" };
}

// Fetch one repo's manifest (displayName + icon) via the contents API, so it works
// for private repos with the same token. Best-effort: a repo without a manifest
// (404) returns {}. The icon SVG is base64-encoded into a data URI.
async function fetchManifest(
  fetchFn: typeof fetch,
  org: string,
  repo: string,
  token: string | null,
  now: () => number,
): Promise<Manifest> {
  const hit = manifestCache.get(repo);
  if (hit && now() - hit.at < MANIFEST_TTL_MS) return hit.value;
  const value = await fetchManifestUncached(fetchFn, org, repo, token);
  manifestCache.set(repo, { at: now(), value });
  return value;
}

async function fetchManifestUncached(
  fetchFn: typeof fetch,
  org: string,
  repo: string,
  token: string | null,
): Promise<Manifest> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const contents = async (path: string): Promise<string | null> => {
    try {
      const response = await fetchFn(`https://api.github.com/repos/${org}/${repo}/contents/${path}`, { headers });
      if (!response.ok) return null;
      const json = (await response.json()) as { content?: string; encoding?: string };
      if (json.encoding !== "base64" || typeof json.content !== "string") return null;
      return json.content.replace(/\s/g, "");
    } catch {
      return null;
    }
  };
  const manifestB64 = await contents("plugin.json");
  if (!manifestB64) return {};
  try {
    const manifest = JSON.parse(Buffer.from(manifestB64, "base64").toString("utf-8"));
    const out: Manifest = {};
    if (typeof manifest.displayName === "string" && manifest.displayName) out.displayName = manifest.displayName;
    if (typeof manifest.icon === "string" && manifest.icon.endsWith(".svg")) {
      const iconB64 = await contents(manifest.icon);
      if (iconB64) out.icon = svgIconDataUri(Buffer.from(iconB64, "base64").toString("utf-8"));
    }
    // The app block is a self-contained AppDescriptor; discovery validates it
    // (via registerApp), so only the shape is checked here.
    if (manifest.app && typeof manifest.app === "object" && !Array.isArray(manifest.app)) out.app = manifest.app as AppDescriptor;
    // Which apps a plugin suits. Declaring none means it suits any, which is what most do;
    // one that only works in a particular app says so and is then offered nowhere else.
    if (Array.isArray(manifest.apps)) out.apps = (manifest.apps as unknown[]).filter((a): a is string => typeof a === "string" && !!a);
    return out;
  } catch {
    return {};
  }
}

export async function scanOrg(deps: OrgScanDeps = {}): Promise<CatalogResult> {
  const now = deps.now ?? Date.now;
  if (cache && now() - cache.at < TTL_MS) return cache.result;
  const fetchFn = deps.fetchFn ?? fetch;
  const org = resolveOrg(deps.getOrg);
  const { token, source } = await resolveToken(deps.env ?? process.env, deps.execFn ?? realExec);
  let rateLimited = false;
  try {
    const entries: CatalogEntry[] = [];
    for (let page = 1; page <= 5; page++) {
      const response = await fetchFn(`https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
          rateLimited = true;
        }
        throw new Error(`org scan http ${response.status}`);
      }
      const repos = (await response.json()) as RepoJson[];
      for (const repo of repos) {
        if (!repo.name) continue;
        const topics = Array.isArray(repo.topics) ? repo.topics : [];
        const kind = classifyRepoTopics(topics);
        if (!kind) continue;
        entries.push({ name: repo.name, url: repo.html_url ?? `https://github.com/${org}/${repo.name}`, kind, description: repo.description ?? "", deprecated: repo.archived === true, topics });
      }
      if (repos.length < 100) break;
    }
    // Manifest enrichment is best-effort and MUST NOT affect the base catalog.
    // Only with a token: anonymous requests share a tiny 60/hr budget that the
    // per-repo fan-out would exhaust, starving the repo-list call itself.
    if (token) {
      try {
        await Promise.all(
          entries.map(async (entry) => {
            const manifest = await fetchManifest(fetchFn, org, entry.name, token, now);
            if (manifest.displayName) entry.displayName = manifest.displayName;
            if (manifest.icon) entry.icon = manifest.icon;
            if (manifest.app) entry.app = manifest.app;
            if (manifest.apps) entry.apps = manifest.apps;
          }),
        );
      } catch {
        // enrichment failure never empties the catalog
      }
    }
    const result: CatalogResult = { entries, source, org, rateLimited: false, sources: [] };
    if (entries.length > 0 || !cache) cache = { at: now(), result };
    return cache.result;
  } catch {
    if (cache) return cache.result;
    const empty: CatalogResult = { entries: [], source, org, rateLimited, sources: [] };
    return empty;
  }
}
