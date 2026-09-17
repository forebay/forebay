// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, screen } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import type { ProviderRow, PluginConfigSchema } from "@forebay/shared";
import ProviderDetail from "./ProviderDetail.svelte";

function makeProvider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "stub",
    label: "Stub",
    authKind: "oauth",
    accountCount: 0,
    enabled: true,
    exposure: { claude: true, opencode: true },
    accountPool: "stub",
    sharedWith: [],
    pluginName: "stub-auth",
    ...overrides,
  };
}

describe("ProviderDetail", () => {
  it("fetches the forebay home's config schemas and renders controls for the matching plugin", async () => {
    const configSchemas = vi.fn(async () => ({
      ok: true,
      data: [{ plugin: "stub-auth", defaults: { verbose: false }, current: {} }] as PluginConfigSchema[],
    }) as const);
    stubForebay({ configSchemas, accountsList: async () => ({ ok: true, data: [] }) });

    render(ProviderDetail, { provider: makeProvider(), apps: [], onClose: vi.fn(), onChanged: vi.fn() });

    await waitFor(() => expect(configSchemas).toHaveBeenCalledWith("forebay"));
    expect(await screen.findByRole("switch", { name: "stub-auth verbose" })).toBeInTheDocument();
  });

  it("shows a fallback message when no schema matches the provider's plugin", async () => {
    stubForebay({
      configSchemas: async () => ({ ok: true, data: [{ plugin: "some-other-plugin", defaults: {}, current: {} }] }),
      accountsList: async () => ({ ok: true, data: [] }),
    });

    render(ProviderDetail, { provider: makeProvider(), apps: [], onClose: vi.fn(), onChanged: vi.fn() });

    expect(await screen.findByText(/no settings for this provider/i)).toBeInTheDocument();
  });

  it("shows the shared-pool note only when sharedWith is non-empty", async () => {
    stubForebay({ configSchemas: async () => ({ ok: true, data: [] }), accountsList: async () => ({ ok: true, data: [] }) });

    const { rerender } = render(ProviderDetail, {
      provider: makeProvider({ sharedWith: ["gemini-cli"] }),
      apps: [],
      onClose: vi.fn(),
      onChanged: vi.fn(),
    });
    expect(await screen.findByText(/shares its account pool with gemini-cli/i)).toBeInTheDocument();

    await rerender({ provider: makeProvider({ sharedWith: [] }), apps: [], onClose: vi.fn(), onChanged: vi.fn() });
    await waitFor(() => expect(screen.queryByText(/shares its account pool/i)).toBeNull());
  });
});
