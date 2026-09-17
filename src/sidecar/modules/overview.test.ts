import { describe, it, expect } from "vitest";
import { overviewSummary } from "./overview.js";
import type { AccountSummary } from "../../../vendor/usage/types.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";

function account(provider: string, enabled: boolean, remaining: number | null): AccountSummary {
  return {
    email: `${provider}@test`,
    enabled,
    lastUsed: 0,
    rateLimits: {},
    quotas: remaining === null ? {} : { "5-hour": { remaining, resetTime: null } },
    quotaUpdatedAt: 0,
    provider,
  };
}

const homes: PluginHome[] = [
  { id: "forebay", label: "Forebay", dir: "/forebay", present: true, managesPlugins: true },
  { id: "claude", label: "Claude", dir: "/claude", present: true, managesPlugins: true },
];

const deps = {
  probe: async () => true,
  accounts: () => [account("anthropic", true, 0.9), account("anthropic", false, 0.4), account("google", true, null)],
  homes: async () => homes,
  pluginsIn: (dir: string) => (dir === "/forebay" ? [{}, {}] : [{}]),
  detect: async () => ({ claude: true, opencode: false }),
  providers: () => [{ provider: "anthropic" }, { provider: "google" }],
};

describe("overviewSummary aggregates", () => {
  it("computes enabled accounts, apps detected, plugins installed, and per-provider health", async () => {
    const result = await overviewSummary(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;
    expect(data.providersConnected).toBe(2);
    expect(data.accountsTotal).toBe(3);
    expect(data.accountsEnabled).toBe(2);
    expect(data.appsDetected).toBe(1);
    expect(data.pluginsInstalled).toBe(3);
    expect(data.serverRunning).toBe(true);
    const anthropic = data.providerHealth.find((p) => p.provider === "anthropic");
    expect(anthropic).toEqual({ provider: "anthropic", accounts: 2, quotaMinPct: 40 });
    const google = data.providerHealth.find((p) => p.provider === "google");
    expect(google).toEqual({ provider: "google", accounts: 1, quotaMinPct: null });
  });

  it("degrades server status to false when the probe fails", async () => {
    const result = await overviewSummary({ ...deps, probe: async () => false });
    expect(result.ok && result.data.serverRunning).toBe(false);
  });
});
