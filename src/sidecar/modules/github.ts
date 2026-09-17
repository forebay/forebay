import { ECOSYSTEM_ORG, getConfigValue, setConfigValue } from "@intisy-ai/basekit";
import { realExec, resetOrgScanCache, resolveToken } from "../lib/orgScan.js";
import { parseRepoRef } from "../../../packages/shared/src/repoRef.js";
import type { GithubAccountView, GithubStatus, Result } from "../../../packages/shared/src/domain.js";
import { ok, err, wrap } from "../result.js";

export interface GithubDeps {
  fetchFn?: typeof fetch;
  execFn?: (file: string, args: string[]) => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

// Reuses the GitHub CLI's own public OAuth client id: the device flow needs no
// client secret and registers no app of ours, so this is safe to keep in source.
const GH_OAUTH_CLIENT_ID = "178c6fc778ccc68e1d6a";
const GH_OAUTH_SCOPE = "repo read:org";

interface DeviceFlowState { deviceCode: string; expiresAt: number; intervalMs: number }
let deviceFlowState: DeviceFlowState | null = null;

// Test-only: the device flow keeps its single in-flight state in this module,
// so tests need a way to clear it between cases instead of leaking it across them.
export function resetDeviceFlowState(): void { deviceFlowState = null; }

interface StoredGithubAccount { login: string; token: string; name?: string | null; avatarUrl?: string | null }
interface GithubUser { login: string; name: string | null; avatarUrl: string | null }

function toView(a: StoredGithubAccount): GithubAccountView {
  return { login: a.login, name: a.name ?? null, avatarUrl: a.avatarUrl ?? null };
}

async function validateToken(fetchFn: typeof fetch, token: string): Promise<Result<GithubUser>> {
  try {
    const response = await fetchFn("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return err(`GitHub rejected the token (${response.status})`);
    const json = (await response.json()) as { login?: string; name?: string | null; avatar_url?: string | null };
    if (typeof json.login !== "string" || !json.login) return err("GitHub response had no login");
    return ok({
      login: json.login,
      name: typeof json.name === "string" && json.name ? json.name : null,
      avatarUrl: typeof json.avatar_url === "string" && json.avatar_url ? json.avatar_url : null,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

async function fetchUserBestEffort(fetchFn: typeof fetch, token: string): Promise<GithubUser | null> {
  const result = await validateToken(fetchFn, token);
  return result.ok ? result.data : null;
}

// Resolves the locally-signed-in GitHub CLI account, independent of whichever
// source actually wins the active token. detected is true once `gh` reports a
// token; account is best-effort (null if the /user fetch fails).
async function resolveGhCli(
  execFn: (file: string, args: string[]) => Promise<string>,
  fetchFn: typeof fetch,
): Promise<{ detected: boolean; account: GithubAccountView | null }> {
  let token: string;
  try {
    token = (await execFn("gh", ["auth", "token"])).trim();
  } catch {
    return { detected: false, account: null };
  }
  if (!token) return { detected: false, account: null };
  const user = await fetchUserBestEffort(fetchFn, token);
  return { detected: true, account: user ? { login: user.login, name: user.name, avatarUrl: user.avatarUrl } : null };
}

function storedAccounts(): StoredGithubAccount[] {
  const accounts = getConfigValue("forebay", "githubAccounts");
  return Array.isArray(accounts) ? (accounts as StoredGithubAccount[]) : [];
}

function activeLoginOf(accounts: StoredGithubAccount[]): string | null {
  const configured = getConfigValue("forebay", "githubActiveLogin");
  if (typeof configured === "string" && accounts.some((a) => a.login === configured)) return configured;
  return accounts[0]?.login ?? null;
}

function storeAccount(user: GithubUser, token: string): void {
  const accounts = storedAccounts().filter((a) => a.login !== user.login);
  accounts.push({ login: user.login, token, name: user.name, avatarUrl: user.avatarUrl });
  setConfigValue("forebay", "githubAccounts", accounts);
  setConfigValue("forebay", "githubActiveLogin", user.login);
  resetOrgScanCache();
}

// Best-effort: a token without the repo/public_repo scope gets a 403, which must
// never fail the surrounding add/connect flow.
async function starRepo(fetchFn: typeof fetch, token: string, owner: string, repo: string, starred: boolean): Promise<void> {
  try {
    await fetchFn(`https://api.github.com/user/starred/${owner}/${repo}`, {
      method: starred ? "PUT" : "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
    });
  } catch {
    // starring is a nice-to-have, never lets a network failure surface to the caller
  }
}

async function starForebay(fetchFn: typeof fetch, token: string): Promise<void> {
  await starRepo(fetchFn, token, ECOSYSTEM_ORG, "forebay", true);
}

const FOREBAY_REPO_URL = `https://github.com/${ECOSYSTEM_ORG}/forebay`;

// Whether the active account has starred Forebay: 204 starred, 404 not; null when
// unknown (no token or a transient error) so the UI can leave the toggle neutral.
async function checkForebayStarred(fetchFn: typeof fetch, token: string): Promise<boolean | null> {
  try {
    const response = await fetchFn(`https://api.github.com/user/starred/${ECOSYSTEM_ORG}/forebay`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 204) return true;
    if (response.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

export function githubStatus(deps: GithubDeps = {}): Promise<Result<GithubStatus>> {
  return wrap(async () => {
    const env = deps.env ?? process.env;
    const execFn = deps.execFn ?? realExec;
    const fetchFn = deps.fetchFn ?? fetch;
    const { token, source } = await resolveToken(env, execFn);
    const accounts = storedAccounts();
    const activeLogin = activeLoginOf(accounts);

    let login: string | null = null;
    let name: string | null = null;
    let avatarUrl: string | null = null;
    if (token) {
      if (source === "config") {
        const active = accounts.find((a) => a.login === activeLogin) ?? accounts[0] ?? null;
        if (active) {
          login = active.login;
          name = active.name ?? null;
          avatarUrl = active.avatarUrl ?? null;
        }
      } else {
        const user = await fetchUserBestEffort(fetchFn, token);
        if (user) {
          login = user.login;
          name = user.name;
          avatarUrl = user.avatarUrl;
        }
      }
    }

    const ghCli = await resolveGhCli(execFn, fetchFn);
    const forebayStarred = token ? await checkForebayStarred(fetchFn, token) : null;

    return {
      source,
      connected: token !== null,
      login,
      name,
      avatarUrl,
      ghCliDetected: ghCli.detected,
      ghCli: ghCli.account,
      accounts: accounts.map(toView),
      activeLogin,
      forebayRepoUrl: FOREBAY_REPO_URL,
      forebayStarred,
    };
  });
}

// One-way: only ever stars, never unstars. Stars with every stored account's
// token (best-effort each) so all connected accounts back the project, falling
// back to the single resolved token (env/gh) when no account is stored.
export async function githubStarForebay(deps: GithubDeps = {}): Promise<Result<void>> {
  const fetchFn = deps.fetchFn ?? fetch;
  const accounts = storedAccounts();
  if (accounts.length > 0) {
    await Promise.all(accounts.map((a) => starRepo(fetchFn, a.token, ECOSYSTEM_ORG, "forebay", true)));
    return ok(undefined);
  }
  const env = deps.env ?? process.env;
  const execFn = deps.execFn ?? realExec;
  const { token } = await resolveToken(env, execFn);
  if (!token) return err("connect a GitHub account first");
  await starRepo(fetchFn, token, ECOSYSTEM_ORG, "forebay", true);
  return ok(undefined);
}

export async function githubAddAccount(token: string, star: boolean, deps: GithubDeps = {}): Promise<Result<{ login: string }>> {
  const fetchFn = deps.fetchFn ?? fetch;
  const trimmed = token.trim();
  if (!trimmed) return err("token is required");
  const validated = await validateToken(fetchFn, trimmed);
  if (!validated.ok) return validated;
  storeAccount(validated.data, trimmed);
  if (star) await starForebay(fetchFn, trimmed);
  return ok({ login: validated.data.login });
}

export async function githubConnectGhCli(star: boolean, deps: GithubDeps = {}): Promise<Result<{ login: string }>> {
  const execFn = deps.execFn ?? realExec;
  const fetchFn = deps.fetchFn ?? fetch;
  let token: string;
  try {
    token = (await execFn("gh", ["auth", "token"])).trim();
  } catch {
    return err("GitHub CLI has no token");
  }
  if (!token) return err("GitHub CLI has no token");
  const validated = await validateToken(fetchFn, token);
  if (!validated.ok) return validated;
  storeAccount(validated.data, token);
  if (star) await starForebay(fetchFn, token);
  return ok({ login: validated.data.login });
}

export async function githubSwitchAccount(login: string, _deps: GithubDeps = {}): Promise<Result<void>> {
  const accounts = storedAccounts();
  if (!accounts.some((a) => a.login === login)) return err("unknown account");
  setConfigValue("forebay", "githubActiveLogin", login);
  resetOrgScanCache();
  return ok(undefined);
}

export async function githubRemoveAccount(login: string, _deps: GithubDeps = {}): Promise<Result<void>> {
  const accounts = storedAccounts();
  const remaining = accounts.filter((a) => a.login !== login);
  setConfigValue("forebay", "githubAccounts", remaining);
  const activeLogin = getConfigValue("forebay", "githubActiveLogin");
  if (activeLogin === login) setConfigValue("forebay", "githubActiveLogin", remaining[0]?.login ?? "");
  resetOrgScanCache();
  return ok(undefined);
}

// Best-effort star/unstar of an arbitrary repo with the active GitHub account.
// Favoriting a plugin is still a success with no token or an unparseable url;
// this only mirrors the local favorite onto GitHub when it can.
export async function githubSetStar(url: string, starred: boolean, deps: GithubDeps = {}): Promise<Result<void>> {
  const env = deps.env ?? process.env;
  const execFn = deps.execFn ?? realExec;
  const fetchFn = deps.fetchFn ?? fetch;
  const { token } = await resolveToken(env, execFn);
  if (!token) return ok(undefined);
  const ref = parseRepoRef(url);
  if (!ref) return ok(undefined);
  await starRepo(fetchFn, token, ref.owner, ref.repo, starred);
  return ok(undefined);
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
}

export async function githubDeviceStart(
  deps: GithubDeps = {},
): Promise<Result<{ userCode: string; verificationUri: string; intervalSeconds: number }>> {
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const response = await fetchFn("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GH_OAUTH_CLIENT_ID, scope: GH_OAUTH_SCOPE }),
    });
    if (!response.ok) return err(`GitHub device flow start failed (${response.status})`);
    const json = (await response.json()) as DeviceCodeResponse;
    if (typeof json.device_code !== "string" || typeof json.user_code !== "string" || typeof json.verification_uri !== "string") {
      return err("GitHub device flow response was malformed");
    }
    const intervalMs = (json.interval && json.interval > 0 ? json.interval : 5) * 1000;
    deviceFlowState = {
      deviceCode: json.device_code,
      expiresAt: Date.now() + (json.expires_in ?? 900) * 1000,
      intervalMs,
    };
    return ok({ userCode: json.user_code, verificationUri: json.verification_uri, intervalSeconds: intervalMs / 1000 });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  interval?: number;
}

export type DevicePollStatus = "pending" | "authorized" | "expired" | "denied" | "error";

export async function githubDevicePoll(
  star: boolean,
  deps: GithubDeps = {},
): Promise<Result<{ status: DevicePollStatus; login?: string; message?: string; intervalSeconds?: number }>> {
  const state = deviceFlowState;
  if (!state || Date.now() > state.expiresAt) {
    deviceFlowState = null;
    return ok({ status: "expired" });
  }
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const response = await fetchFn("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GH_OAUTH_CLIENT_ID,
        device_code: state.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const json = (await response.json()) as AccessTokenResponse;
    if (typeof json.access_token === "string" && json.access_token) {
      const token = json.access_token;
      const validated = await validateToken(fetchFn, token);
      deviceFlowState = null;
      if (!validated.ok) return ok({ status: "error", message: validated.error });
      storeAccount(validated.data, token);
      if (star) await starRepo(fetchFn, token, ECOSYSTEM_ORG, "forebay", true);
      return ok({ status: "authorized", login: validated.data.login });
    }
    if (json.error === "authorization_pending") return ok({ status: "pending", intervalSeconds: state.intervalMs / 1000 });
    // GitHub demands a slower cadence after slow_down; if we keep the old interval
    // it returns slow_down forever and never delivers the token even once authorized.
    if (json.error === "slow_down") {
      const nextSeconds = json.interval && json.interval > 0 ? json.interval : state.intervalMs / 1000 + 5;
      state.intervalMs = nextSeconds * 1000;
      return ok({ status: "pending", intervalSeconds: nextSeconds });
    }
    deviceFlowState = null;
    if (json.error === "expired_token") return ok({ status: "expired" });
    if (json.error === "access_denied") return ok({ status: "denied" });
    return ok({ status: "error", message: json.error ?? "unknown error" });
  } catch (e) {
    return ok({ status: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
