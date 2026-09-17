import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ECOSYSTEM_ORG, getConfigValue, setConfigValue } from "@intisy-ai/basekit";
import { resetOrgScanCache, resolveToken } from "../lib/orgScan.js";
import { githubStatus, githubAddAccount, githubSwitchAccount, githubRemoveAccount, githubConnectGhCli, githubSetStar, githubStarForebay, githubDeviceStart, githubDevicePoll, resetDeviceFlowState } from "./github.js";

// A developer's shell usually carries a real GITHUB_TOKEN, and resolveToken prefers the
// environment over a stored account, so a test that does not pass an explicit `env` would
// assert against whatever token happens to be exported. Cleared here rather than per call, so
// the next test written without one is isolated too.
const AMBIENT_TOKEN_VARS = ["GITHUB_TOKEN", "GH_TOKEN"] as const;
const savedTokens: Record<string, string | undefined> = {};

beforeEach(() => {
  resetOrgScanCache();
  resetDeviceFlowState();
  for (const name of AMBIENT_TOKEN_VARS) {
    savedTokens[name] = process.env[name];
    delete process.env[name];
  }
  process.env.HUB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "dash-github-"));
});

afterEach(() => {
  for (const name of AMBIENT_TOKEN_VARS) {
    if (savedTokens[name] === undefined) delete process.env[name];
    else process.env[name] = savedTokens[name];
  }
});

const userFetch = (login: string, extra: { name?: string | null; avatar_url?: string | null } = {}) =>
  (async () => ({ ok: true, status: 200, json: async () => ({ login, ...extra }) })) as unknown as typeof fetch;

const failFetch = (status: number) =>
  (async () => ({ ok: false, status, json: async () => ({}) })) as unknown as typeof fetch;

const noGh = async (): Promise<string> => { throw new Error("no gh"); };

describe("githubStatus", () => {
  it("reports connected via an env token, with identity from the GitHub API", async () => {
    const result = await githubStatus({
      env: { GITHUB_TOKEN: "t" },
      execFn: noGh,
      fetchFn: userFetch("octocat", { name: "Octo Cat", avatar_url: "https://avatars.githubusercontent.com/u/1" }),
    });
    expect(result).toEqual({
      ok: true,
      data: {
        source: "env",
        connected: true,
        login: "octocat",
        name: "Octo Cat",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
        ghCliDetected: false,
        ghCli: null,
        accounts: [],
        activeLogin: null,
        forebayRepoUrl: `https://github.com/${ECOSYSTEM_ORG}/forebay`,
        forebayStarred: null,
      },
    });
  });

  it("reports anonymous with no login when no token is available anywhere", async () => {
    const result = await githubStatus({
      env: {},
      execFn: noGh,
      fetchFn: (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: true,
      data: { source: "anonymous", connected: false, login: null, name: null, avatarUrl: null, ghCliDetected: false, ghCli: null, accounts: [], activeLogin: null, forebayRepoUrl: `https://github.com/${ECOSYSTEM_ORG}/forebay`, forebayStarred: null },
    });
  });

  it("flags the local gh CLI as detected and resolves its identity even when a different source wins the token", async () => {
    const result = await githubStatus({
      env: { GITHUB_TOKEN: "t" },
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""),
      fetchFn: userFetch("clidev", { name: "CLI Dev" }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("env");
      expect(result.data.ghCliDetected).toBe(true);
      expect(result.data.ghCli).toEqual({ login: "clidev", name: "CLI Dev", avatarUrl: null });
    }
  });

  it("reports ghCli as null when gh is not installed", async () => {
    const result = await githubStatus({ env: { GITHUB_TOKEN: "t" }, execFn: noGh, fetchFn: userFetch("octocat") });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ghCliDetected).toBe(false);
      expect(result.data.ghCli).toBeNull();
    }
  });

  it("stays connected but reports a null identity when the GitHub API call fails", async () => {
    const result = await githubStatus({ env: { GITHUB_TOKEN: "t" }, execFn: noGh, fetchFn: failFetch(401) });
    expect(result).toEqual({
      ok: true,
      data: { source: "env", connected: true, login: null, name: null, avatarUrl: null, ghCliDetected: false, ghCli: null, accounts: [], activeLogin: null, forebayRepoUrl: `https://github.com/${ECOSYSTEM_ORG}/forebay`, forebayStarred: null },
    });
  });

  it("lists stored accounts and the active login, using the stored identity for a config-sourced active account", async () => {
    await githubAddAccount("token-a", false, { fetchFn: userFetch("alice", { name: "Alice A", avatar_url: "https://avatars.githubusercontent.com/u/2" }) });
    await githubAddAccount("token-b", false, { fetchFn: userFetch("bob", { name: "Bob B" }) });
    const status = await githubStatus({ env: {}, execFn: noGh, fetchFn: (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data.source).toBe("config");
      expect(status.data.login).toBe("bob");
      expect(status.data.name).toBe("Bob B");
      expect(status.data.accounts).toEqual([
        { login: "alice", name: "Alice A", avatarUrl: "https://avatars.githubusercontent.com/u/2" },
        { login: "bob", name: "Bob B", avatarUrl: null },
      ]);
      expect(status.data.activeLogin).toBe("bob");
    }
  });
});

// Records every call and answers /user with the given login, plus the starred-repo
// PUT with a bare 204 (or throws/errs when starBehavior says so).
function spyFetch(
  login: string,
  calls: { url: string; init?: { method?: string; headers?: Record<string, string> } }[],
  starBehavior: "ok" | "throw" | "403" = "ok",
): typeof fetch {
  return (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ url, init });
    if (url.includes("/user/starred/")) {
      if (starBehavior === "throw") throw new Error("network error");
      if (starBehavior === "403") return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ login }) };
  }) as unknown as typeof fetch;
}

describe("githubAddAccount", () => {
  it("validates the token via the GitHub API, stores the identity, and makes it active", async () => {
    const result = await githubAddAccount("  new-token  ", false, { fetchFn: userFetch("octocat", { name: "Octo Cat", avatar_url: "https://avatars.githubusercontent.com/u/1" }) });
    expect(result).toEqual({ ok: true, data: { login: "octocat" } });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([
      { login: "octocat", token: "new-token", name: "Octo Cat", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
    ]);
    expect(getConfigValue("forebay", "githubActiveLogin")).toBe("octocat");
  });

  it("stores null name/avatarUrl when the API response omits them", async () => {
    await githubAddAccount("token", false, { fetchFn: userFetch("octocat") });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([{ login: "octocat", token: "token", name: null, avatarUrl: null }]);
  });

  it("replaces an existing entry for the same login instead of duplicating it", async () => {
    await githubAddAccount("token-1", false, { fetchFn: userFetch("octocat", { name: "Old Name" }) });
    await githubAddAccount("token-2", false, { fetchFn: userFetch("octocat", { name: "New Name" }) });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([{ login: "octocat", token: "token-2", name: "New Name", avatarUrl: null }]);
  });

  it("rejects an invalid token and stores nothing", async () => {
    const result = await githubAddAccount("bad-token", false, { fetchFn: failFetch(401) });
    expect(result.ok).toBe(false);
    expect(getConfigValue("forebay", "githubAccounts")).toBeUndefined();
  });

  it("rejects a blank token without calling the network", async () => {
    const result = await githubAddAccount("   ", false, { fetchFn: (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch });
    expect(result.ok).toBe(false);
  });

  it("stars Forebay when star is true", async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string> } }[] = [];
    const result = await githubAddAccount("token", true, { fetchFn: spyFetch("octocat", calls) });
    expect(result.ok).toBe(true);
    const starCall = calls.find((c) => c.url === `https://api.github.com/user/starred/${ECOSYSTEM_ORG}/forebay`);
    expect(starCall).toBeDefined();
    expect(starCall?.init?.method).toBe("PUT");
    expect(starCall?.init?.headers?.Authorization).toBe("Bearer token");
  });

  it("does not star when star is false", async () => {
    const calls: { url: string }[] = [];
    const result = await githubAddAccount("token", false, { fetchFn: spyFetch("octocat", calls) });
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.url.includes("/user/starred/"))).toBe(false);
  });

  it("still stores the account and reports success when starring throws", async () => {
    const calls: { url: string }[] = [];
    const result = await githubAddAccount("token", true, { fetchFn: spyFetch("octocat", calls, "throw") });
    expect(result).toEqual({ ok: true, data: { login: "octocat" } });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([{ login: "octocat", token: "token", name: null, avatarUrl: null }]);
  });

  it("still stores the account and reports success when starring returns a non-2xx (insufficient scope)", async () => {
    const calls: { url: string }[] = [];
    const result = await githubAddAccount("token", true, { fetchFn: spyFetch("octocat", calls, "403") });
    expect(result.ok).toBe(true);
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([{ login: "octocat", token: "token", name: null, avatarUrl: null }]);
  });
});

describe("githubConnectGhCli", () => {
  it("resolves the gh token, stores the identity, and makes it active", async () => {
    const result = await githubConnectGhCli(false, {
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""),
      fetchFn: userFetch("clidev", { name: "CLI Dev", avatar_url: "https://avatars.githubusercontent.com/u/3" }),
    });
    expect(result).toEqual({ ok: true, data: { login: "clidev" } });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([
      { login: "clidev", token: "ghtoken", name: "CLI Dev", avatarUrl: "https://avatars.githubusercontent.com/u/3" },
    ]);
    expect(getConfigValue("forebay", "githubActiveLogin")).toBe("clidev");
  });

  it("errors when gh has no token", async () => {
    const result = await githubConnectGhCli(false, { execFn: async () => "", fetchFn: userFetch("clidev") });
    expect(result.ok).toBe(false);
  });

  it("errors when gh is not installed", async () => {
    const result = await githubConnectGhCli(false, { execFn: noGh, fetchFn: userFetch("clidev") });
    expect(result.ok).toBe(false);
  });

  it("errors when the resolved token fails validation", async () => {
    const result = await githubConnectGhCli(false, {
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""),
      fetchFn: failFetch(401),
    });
    expect(result.ok).toBe(false);
    expect(getConfigValue("forebay", "githubAccounts")).toBeUndefined();
  });

  it("stars Forebay using the gh CLI token when star is true", async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string> } }[] = [];
    const result = await githubConnectGhCli(true, {
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""),
      fetchFn: spyFetch("clidev", calls),
    });
    expect(result.ok).toBe(true);
    const starCall = calls.find((c) => c.url === `https://api.github.com/user/starred/${ECOSYSTEM_ORG}/forebay`);
    expect(starCall).toBeDefined();
    expect(starCall?.init?.method).toBe("PUT");
  });

  it("does not star when star is false", async () => {
    const calls: { url: string }[] = [];
    const result = await githubConnectGhCli(false, {
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""),
      fetchFn: spyFetch("clidev", calls),
    });
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.url.includes("/user/starred/"))).toBe(false);
  });

  it("still succeeds when starring fails", async () => {
    const calls: { url: string }[] = [];
    const result = await githubConnectGhCli(true, {
      execFn: async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""),
      fetchFn: spyFetch("clidev", calls, "throw"),
    });
    expect(result.ok).toBe(true);
  });
});

describe("githubSwitchAccount", () => {
  it("makes a stored account active", async () => {
    await githubAddAccount("token-a", false, { fetchFn: userFetch("alice") });
    await githubAddAccount("token-b", false, { fetchFn: userFetch("bob") });
    const result = await githubSwitchAccount("alice");
    expect(result).toEqual({ ok: true, data: undefined });
    expect(getConfigValue("forebay", "githubActiveLogin")).toBe("alice");
  });

  it("errors on an unknown login", async () => {
    const result = await githubSwitchAccount("nobody");
    expect(result.ok).toBe(false);
  });
});

describe("githubRemoveAccount", () => {
  it("removes a stored account and reassigns the active login when it was active", async () => {
    await githubAddAccount("token-a", false, { fetchFn: userFetch("alice") });
    await githubAddAccount("token-b", false, { fetchFn: userFetch("bob") });
    const result = await githubRemoveAccount("bob");
    expect(result).toEqual({ ok: true, data: undefined });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([{ login: "alice", token: "token-a", name: null, avatarUrl: null }]);
    expect(getConfigValue("forebay", "githubActiveLogin")).toBe("alice");
  });

  it("clears the active login when the last account is removed", async () => {
    await githubAddAccount("token-a", false, { fetchFn: userFetch("alice") });
    await githubRemoveAccount("alice");
    const status = await githubStatus({ env: {}, execFn: noGh, fetchFn: userFetch("nobody") });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data.accounts).toEqual([]);
      expect(status.data.activeLogin).toBeNull();
    }
  });
});

describe("resolveToken", () => {
  it("resolves the active stored account's token as the config source", async () => {
    await githubAddAccount("token-a", false, { fetchFn: userFetch("alice") });
    await githubAddAccount("token-b", false, { fetchFn: userFetch("bob") });
    const resolved = await resolveToken({}, noGh);
    expect(resolved).toEqual({ token: "token-b", source: "config" });
  });

  it("still honors a legacy plain githubToken when no accounts are stored", async () => {
    setConfigValue("forebay", "githubToken", "legacy-token");
    const resolved = await resolveToken({}, noGh);
    expect(resolved).toEqual({ token: "legacy-token", source: "config" });
  });

  it("never falls back to the local gh CLI, even when it has a valid token", async () => {
    const resolved = await resolveToken({}, async (f, a) => (f === "gh" && a[0] === "auth" ? "ghtoken" : ""));
    expect(resolved).toEqual({ token: null, source: "anonymous" });
  });
});

describe("githubSetStar", () => {
  it("PUTs the repo's star endpoint when starred is true", async () => {
    await githubAddAccount("token", false, { fetchFn: userFetch("octocat") });
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string> } }[] = [];
    const result = await githubSetStar("https://github.com/o/r", true, { fetchFn: spyFetch("octocat", calls) });
    expect(result).toEqual({ ok: true, data: undefined });
    const starCall = calls.find((c) => c.url === "https://api.github.com/user/starred/o/r");
    expect(starCall?.init?.method).toBe("PUT");
    expect(starCall?.init?.headers?.Authorization).toBe("Bearer token");
  });

  it("DELETEs the repo's star endpoint when starred is false", async () => {
    await githubAddAccount("token", false, { fetchFn: userFetch("octocat") });
    const calls: { url: string; init?: { method?: string } }[] = [];
    const result = await githubSetStar("https://github.com/o/r", false, { fetchFn: spyFetch("octocat", calls) });
    expect(result).toEqual({ ok: true, data: undefined });
    const starCall = calls.find((c) => c.url === "https://api.github.com/user/starred/o/r");
    expect(starCall?.init?.method).toBe("DELETE");
  });

  it("accepts owner/repo shorthand", async () => {
    await githubAddAccount("token", false, { fetchFn: userFetch("octocat") });
    const calls: { url: string }[] = [];
    await githubSetStar("o/r", true, { fetchFn: spyFetch("octocat", calls) });
    expect(calls.some((c) => c.url === "https://api.github.com/user/starred/o/r")).toBe(true);
  });

  it("does nothing (still ok) when there is no token", async () => {
    const calls: { url: string }[] = [];
    const result = await githubSetStar("https://github.com/o/r", true, {
      env: {},
      execFn: noGh,
      fetchFn: spyFetch("octocat", calls),
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls.length).toBe(0);
  });

  it("does nothing (still ok) when the url can't be parsed into an owner/repo", async () => {
    await githubAddAccount("token", false, { fetchFn: userFetch("octocat") });
    const calls: { url: string }[] = [];
    const result = await githubSetStar("not a repo url", true, { fetchFn: spyFetch("octocat", calls) });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls.length).toBe(0);
  });
});

describe("githubStatus forebay star state", () => {
  it("reports forebayStarred true when the star check returns 204", async () => {
    const result = await githubStatus({ env: { GITHUB_TOKEN: "t" }, execFn: noGh, fetchFn: spyFetch("octocat", []) });
    expect(result.ok && result.data.forebayStarred).toBe(true);
  });

  it("reports forebayStarred false when the star check returns 404", async () => {
    const notStarred = (async (url: string) =>
      url.includes("/user/starred/")
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ login: "octocat" }) }) as unknown as typeof fetch;
    const result = await githubStatus({ env: { GITHUB_TOKEN: "t" }, execFn: noGh, fetchFn: notStarred });
    expect(result.ok && result.data.forebayStarred).toBe(false);
    if (result.ok) expect(result.data.forebayRepoUrl).toBe(`https://github.com/${ECOSYSTEM_ORG}/forebay`);
  });
});

describe("githubStarForebay", () => {
  it("stars Forebay with every stored account's token, one PUT each", async () => {
    await githubAddAccount("token-a", false, { fetchFn: userFetch("alice") });
    await githubAddAccount("token-b", false, { fetchFn: userFetch("bob") });
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string> } }[] = [];
    const result = await githubStarForebay({ fetchFn: spyFetch("bob", calls) });
    expect(result).toEqual({ ok: true, data: undefined });
    const starCalls = calls.filter((c) => c.url === `https://api.github.com/user/starred/${ECOSYSTEM_ORG}/forebay` && c.init?.method === "PUT");
    expect(starCalls.length).toBe(2);
    expect(starCalls.map((c) => c.init?.headers?.Authorization)).toEqual(
      expect.arrayContaining(["Bearer token-a", "Bearer token-b"]),
    );
  });

  it("falls back to the resolved env/gh token when no account is stored", async () => {
    const calls: { url: string; init?: { method?: string } }[] = [];
    const result = await githubStarForebay({ env: { GITHUB_TOKEN: "t" }, execFn: noGh, fetchFn: spyFetch("octocat", calls) });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls.some((c) => c.url.includes(`/user/starred/${ECOSYSTEM_ORG}/forebay`) && c.init?.method === "PUT")).toBe(true);
  });

  it("errors when there is no token at all", async () => {
    const calls: { url: string }[] = [];
    const result = await githubStarForebay({ env: {}, execFn: noGh, fetchFn: spyFetch("octocat", calls) });
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

const deviceCodeFetch = (
  status: "pending" | "success" | "denied" | "error",
  login = "octocat",
): typeof fetch =>
  (async (url: string) => {
    if (url === "https://github.com/login/device/code") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          device_code: "dev-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        }),
      };
    }
    if (url === "https://github.com/login/oauth/access_token") {
      if (status === "pending") return { ok: true, status: 200, json: async () => ({ error: "authorization_pending" }) };
      if (status === "denied") return { ok: true, status: 200, json: async () => ({ error: "access_denied" }) };
      if (status === "error") return { ok: true, status: 200, json: async () => ({ error: "something_else" }) };
      return { ok: true, status: 200, json: async () => ({ access_token: "device-token" }) };
    }
    if (url === "https://api.github.com/user") return { ok: true, status: 200, json: async () => ({ login }) };
    if (url.includes("/user/starred/")) return { ok: true, status: 204, json: async () => ({}) };
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;

describe("githubDeviceStart", () => {
  it("starts the device flow and returns the user code and verification uri", async () => {
    const result = await githubDeviceStart({ fetchFn: deviceCodeFetch("success") });
    expect(result).toEqual({
      ok: true,
      data: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", intervalSeconds: 1 },
    });
  });

  it("errors when GitHub rejects the device code request", async () => {
    const result = await githubDeviceStart({ fetchFn: failFetch(400) });
    expect(result.ok).toBe(false);
  });
});

describe("githubDevicePoll", () => {
  it("reports expired when no device flow has been started", async () => {
    const result = await githubDevicePoll(false, { fetchFn: deviceCodeFetch("pending") });
    expect(result).toEqual({ ok: true, data: { status: "expired" } });
  });

  it("reports pending while GitHub is still waiting on the user, then authorized once granted, storing the account", async () => {
    await githubDeviceStart({ fetchFn: deviceCodeFetch("pending") });
    const pending = await githubDevicePoll(false, { fetchFn: deviceCodeFetch("pending") });
    expect(pending.ok && pending.data.status).toBe("pending");

    const authorized = await githubDevicePoll(false, { fetchFn: deviceCodeFetch("success") });
    expect(authorized).toEqual({ ok: true, data: { status: "authorized", login: "octocat" } });
    expect(getConfigValue("forebay", "githubAccounts")).toEqual([{ login: "octocat", token: "device-token", name: null, avatarUrl: null }]);
  });

  it("stars Forebay with the new token when star is true", async () => {
    await githubDeviceStart({ fetchFn: deviceCodeFetch("pending") });
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string> } }[] = [];
    const fetchFn = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      calls.push({ url, init });
      return (deviceCodeFetch("success") as unknown as (u: string, i?: unknown) => Promise<unknown>)(url, init);
    }) as unknown as typeof fetch;
    await githubDevicePoll(true, { fetchFn });
    const starCall = calls.find((c) => c.url === `https://api.github.com/user/starred/${ECOSYSTEM_ORG}/forebay`);
    expect(starCall?.init?.method).toBe("PUT");
    expect(starCall?.init?.headers?.Authorization).toBe("Bearer device-token");
  });

  it("backs off to the slower interval on slow_down and stays pending", async () => {
    await githubDeviceStart({ fetchFn: deviceCodeFetch("pending") });
    const slowFetch = (async (url: string) =>
      url === "https://github.com/login/oauth/access_token"
        ? { ok: true, status: 200, json: async () => ({ error: "slow_down", interval: 8 }) }
        : { ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch;
    const result = await githubDevicePoll(false, { fetchFn: slowFetch });
    expect(result.ok && result.data.status).toBe("pending");
    expect(result.ok && result.data.intervalSeconds).toBe(8);
  });

  it("maps access_denied to denied", async () => {
    await githubDeviceStart({ fetchFn: deviceCodeFetch("denied") });
    const result = await githubDevicePoll(false, { fetchFn: deviceCodeFetch("denied") });
    expect(result).toEqual({ ok: true, data: { status: "denied" } });
  });

  it("maps an unrecognized error to status error with the message", async () => {
    await githubDeviceStart({ fetchFn: deviceCodeFetch("error") });
    const result = await githubDevicePoll(false, { fetchFn: deviceCodeFetch("error") });
    expect(result).toEqual({ ok: true, data: { status: "error", message: "something_else" } });
  });

  it("reports expired once the device code's expiry has passed", async () => {
    const fetchFn = (async (url: string) => {
      if (url === "https://github.com/login/device/code") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            device_code: "dev-code",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: -1,
            interval: 1,
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    await githubDeviceStart({ fetchFn });
    const result = await githubDevicePoll(false, { fetchFn: deviceCodeFetch("pending") });
    expect(result).toEqual({ ok: true, data: { status: "expired" } });
  });
});
