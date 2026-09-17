// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import Usage from "./Usage.svelte";
import type { UsageSession } from "@forebay/shared";

function session(over: Partial<UsageSession> & { id: string; updated: number }): UsageSession {
  return {
    id: over.id,
    title: over.title ?? over.id,
    tokens: over.tokens ?? { input: 10, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    messageCount: over.messageCount ?? 2,
    source: over.source ?? "claude",
    updated: over.updated,
    costByDay: over.costByDay ?? {},
    models: over.models ?? [{ id: "sonnet", provider: "anthropic", tokens: 20 }],
  };
}

const now = Date.now();
const day = 86_400_000;

beforeEach(() => {
  stubForebay({
    usageSnapshot: async () => ({
      ok: true,
      data: {
        accounts: [{ provider: "anthropic", id: "a1" }],
        updatedAt: new Date(now).toISOString(),
        models: {},
        sessions: [
          session({ id: "recent", title: "Recent work", updated: now - day, models: [{ id: "sonnet", provider: "anthropic", tokens: 500 }] }),
          session({ id: "old", title: "Old work", updated: now - 20 * day, models: [{ id: "opus", provider: "anthropic", tokens: 100 }] }),
        ],
      },
    }),
  });
});

async function mount() {
  const utils = render(Usage);
  // allow onMount async load to resolve
  await new Promise((r) => setTimeout(r, 0));
  return utils;
}

describe("Usage screen", () => {
  it("filters sessions by the selected range", async () => {
    const { getByText, queryByText } = await mount();
    // Default range 7d: only the recent session shows in the table.
    expect(getByText("Recent work")).toBeInTheDocument();
    expect(queryByText("Old work")).toBeNull();
    await fireEvent.click(getByText("All"));
    expect(getByText("Old work")).toBeInTheDocument();
  });

  it("narrows the table when a model bar is clicked", async () => {
    const { getByText, queryByText, container } = await mount();
    await fireEvent.click(getByText("All"));
    // The 'opus' label appears both as a bar and in the table, so target the bar button.
    const bars = container.querySelectorAll("button.bar-row");
    const opusBar = Array.from(bars).find((b) => b.textContent?.includes("opus"));
    await fireEvent.click(opusBar as Element);
    expect(getByText("Old work")).toBeInTheDocument();
    expect(queryByText("Recent work")).toBeNull();
  });

  it("searches the session table", async () => {
    const { getByText, queryByText, getByPlaceholderText } = await mount();
    await fireEvent.click(getByText("All"));
    await fireEvent.input(getByPlaceholderText("Search sessions"), { target: { value: "old" } });
    expect(getByText("Old work")).toBeInTheDocument();
    expect(queryByText("Recent work")).toBeNull();
  });

  it("shows the estimated cost and a priced footnote when pricing data is available", async () => {
    stubForebay({
      usageSnapshot: async () => ({
        ok: true,
        data: {
          accounts: [{ provider: "anthropic", id: "a1" }],
          updatedAt: new Date(now).toISOString(),
          models: {},
          sessions: [session({ id: "recent", title: "Recent work", updated: now - day })],
          estimatedCostUsd: 12.34,
          pricedModels: 2,
          unpricedModels: 1,
          pricesUpdatedAt: "2026-01",
        },
      }),
    });
    const { getByText } = await mount();
    expect(getByText("$12.34")).toBeInTheDocument();
    expect(getByText("Est. cost (all-time)")).toBeInTheDocument();
    expect(getByText((_, node) => node?.textContent === "All-time estimate at list prices (as of 2026-01); 1 model(s) unpriced.")).toBeInTheDocument();
  });

  it("shows an unavailable cost state instead of $0.00 when no pricing data exists", async () => {
    const { getByText, queryByText } = await mount();
    expect(getByText("n/a")).toBeInTheDocument();
    expect(queryByText("$0.00")).toBeNull();
  });
});
