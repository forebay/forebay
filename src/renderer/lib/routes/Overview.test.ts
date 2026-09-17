// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { router } from "../router.js";
import { dayKey } from "../charts/chartMath.js";
import Overview from "./Overview.svelte";

const now = Date.now();

function summaryWith(providerHealth: { provider: string; accounts: number; quotaMinPct: number | null }[]) {
  return {
    providersConnected: 2,
    accountsTotal: 5,
    accountsEnabled: 3,
    appsDetected: 1,
    pluginsInstalled: 7,
    providerHealth,
    serverRunning: true,
    serverPort: 34567,
  };
}

beforeEach(() => {
  router.set({ screen: "overview" });
  stubForebay({
    overviewSummary: async () => ({
      ok: true,
      data: {
        providersConnected: 2,
        accountsTotal: 5,
        accountsEnabled: 3,
        appsDetected: 1,
        pluginsInstalled: 7,
        providerHealth: [{ provider: "anthropic", accounts: 3, quotaMinPct: 42 }],
        serverRunning: true,
        serverPort: 34567,
      },
    }),
    usageSnapshot: async () => ({
      ok: true,
      data: {
        accounts: [],
        updatedAt: new Date(now).toISOString(),
        models: {},
        sessions: [
          {
            id: "s1",
            title: "Latest session",
            tokens: { input: 50, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
            messageCount: 3,
            source: "claude",
            updated: now,
            costByDay: {},
            models: [{ id: "sonnet", provider: "anthropic", tokens: 100 }],
          },
        ],
      },
    }),
  });
});

async function mount() {
  const utils = render(Overview);
  await new Promise((r) => setTimeout(r, 0));
  return utils;
}

describe("Overview dashboard", () => {
  it("renders the extended stat set and provider health", async () => {
    const { getByText } = await mount();
    expect(getByText("Plugins installed")).toBeInTheDocument();
    expect(getByText("7")).toBeInTheDocument();
    expect(getByText("anthropic")).toBeInTheDocument();
    expect(getByText("Latest session")).toBeInTheDocument();
  });

  it("navigates when a panel header link is clicked", async () => {
    const { getByText } = await mount();
    await fireEvent.click(getByText("Providers →"));
    expect(get(router).screen).toBe("providers");
  });

  it("still renders stats when the usage read fails", async () => {
    stubForebay({
      overviewSummary: async () => ({
        ok: true,
        data: {
          providersConnected: 2,
          accountsTotal: 5,
          accountsEnabled: 3,
          appsDetected: 1,
          pluginsInstalled: 7,
          providerHealth: [],
          serverRunning: true,
          serverPort: 34567,
        },
      }),
      usageSnapshot: async () => ({ ok: false, error: "scan failed" }),
    });
    const { getByText } = await mount();
    expect(getByText("Plugins installed")).toBeInTheDocument();
  });

  it("hides the reasoning series from the usage chart when reasoning tokens are always zero", async () => {
    stubForebay({
      overviewSummary: async () => ({ ok: true, data: summaryWith([]) }),
      usageSnapshot: async () => ({
        ok: true,
        data: {
          accounts: [],
          updatedAt: new Date(now).toISOString(),
          models: {},
          sessions: [
            {
              id: "s1",
              title: "Latest session",
              tokens: { input: 50, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
              messageCount: 3,
              source: "claude",
              updated: now,
              costByDay: { [dayKey(now)]: { tokens: 100, tokensInput: 50, tokensOutput: 50, tokensReasoning: 0, messageCount: 3 } },
              models: [{ id: "sonnet", provider: "anthropic", tokens: 100 }],
            },
          ],
        },
      }),
    });
    const { getByText, queryByText } = await mount();
    expect(getByText("input")).toBeInTheDocument();
    expect(getByText("output")).toBeInTheDocument();
    expect(queryByText("reasoning")).not.toBeInTheDocument();
  });

  it("shows the reasoning series in the usage chart when reasoning tokens are non-zero", async () => {
    stubForebay({
      overviewSummary: async () => ({ ok: true, data: summaryWith([]) }),
      usageSnapshot: async () => ({
        ok: true,
        data: {
          accounts: [],
          updatedAt: new Date(now).toISOString(),
          models: {},
          sessions: [
            {
              id: "s1",
              title: "Latest session",
              tokens: { input: 50, output: 50, reasoning: 20, cacheRead: 0, cacheWrite: 0 },
              messageCount: 3,
              source: "claude",
              updated: now,
              costByDay: { [dayKey(now)]: { tokens: 120, tokensInput: 50, tokensOutput: 50, tokensReasoning: 20, messageCount: 3 } },
              models: [{ id: "sonnet", provider: "anthropic", tokens: 120 }],
            },
          ],
        },
      }),
    });
    const { getByText } = await mount();
    expect(getByText("input")).toBeInTheDocument();
    expect(getByText("output")).toBeInTheDocument();
    expect(getByText("reasoning")).toBeInTheDocument();
  });
});
