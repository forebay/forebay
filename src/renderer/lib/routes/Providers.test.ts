// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { router, consumeParams } from "../router.js";
import { toasts, toast } from "../toast.js";
import Providers from "./Providers.svelte";

describe("Providers screen", () => {
  beforeEach(() => {
    get(toasts).slice().forEach((t) => toast.dismiss(t.id));
  });

  it("renders a provider row from providersList and toggles exposure", async () => {
    const providersSetExposure = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
      providersSetExposure,
    });

    const { getByText, getByRole, getByTitle } = render(Providers);

    await waitFor(() => expect(getByText("Stub")).toBeTruthy());
    expect(getByText(/2 accounts/i)).toBeTruthy();

    const clPill = await waitFor(() => getByTitle("Claude Code"));
    const opPill = getByTitle("OpenCode");
    expect(clPill.classList.contains("on")).toBe(true);
    expect(opPill.classList.contains("na")).toBe(true);

    const enabledSwitch = getByRole("switch", { name: /Stub enabled/i });
    expect(enabledSwitch.getAttribute("aria-checked")).toBe("true");

    await fireEvent.click(opPill);
    expect(providersSetExposure).toHaveBeenCalledWith("stub", "opencode", true);
  });

  it("shows an inline error when providersList fails", async () => {
    stubForebay({ providersList: async () => ({ ok: false, error: "boom" }) });
    const { getByText } = render(Providers);
    await waitFor(() => expect(getByText(/boom/i)).toBeTruthy());
  });

  it("offers the All/Connected/OAuth/API key filter chips", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "oauth-only", label: "OAuthOnly", accountPool: "oauth-only", sharedWith: [], pluginName: "oauth-only", authKind: "oauth", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "key-connected", label: "KeyConnected", accountPool: "key-connected", sharedWith: [], pluginName: "key-connected", authKind: "api-key", accountCount: 1, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "key-unconnected", label: "KeyUnconnected", accountPool: "key-unconnected", sharedWith: [], pluginName: "key-unconnected", authKind: "api-key", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
    });

    const { getByText, container } = render(Providers);
    await waitFor(() => expect(getByText("OAuthOnly")).toBeTruthy());

    const toolbar = within(container.querySelector(".toolbar")!);
    expect(toolbar.getByRole("button", { name: "All" })).toBeTruthy();
    expect(toolbar.getByRole("button", { name: "Connected" })).toBeTruthy();
    expect(toolbar.getByRole("button", { name: "OAuth" })).toBeTruthy();
    expect(toolbar.getByRole("button", { name: "API key" })).toBeTruthy();
    expect(toolbar.queryByRole("button", { name: "Local" })).toBeNull();
  });

  it("filters to authKind:oauth rows when the OAuth chip is active", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "oauth-only", label: "OAuthOnly", accountPool: "oauth-only", sharedWith: [], pluginName: "oauth-only", authKind: "oauth", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "key-unconnected", label: "KeyUnconnected", accountPool: "key-unconnected", sharedWith: [], pluginName: "key-unconnected", authKind: "api-key", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
    });

    const { getByRole, getByText, queryByText } = render(Providers);
    await waitFor(() => expect(getByText("OAuthOnly")).toBeTruthy());
    expect(getByText("KeyUnconnected")).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "OAuth" }));

    await waitFor(() => expect(queryByText("KeyUnconnected")).toBeNull());
    expect(getByText("OAuthOnly")).toBeTruthy();
  });

  it("filters to authKind:api-key rows when the API key chip is active", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "oauth-only", label: "OAuthOnly", accountPool: "oauth-only", sharedWith: [], pluginName: "oauth-only", authKind: "oauth", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "key-only", label: "KeyOnly", accountPool: "key-only", sharedWith: [], pluginName: "key-only", authKind: "api-key", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
    });

    const { getByRole, getByText, queryByText } = render(Providers);
    await waitFor(() => expect(getByText("KeyOnly")).toBeTruthy());
    expect(getByText("OAuthOnly")).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "API key" }));

    await waitFor(() => expect(queryByText("OAuthOnly")).toBeNull());
    expect(getByText("KeyOnly")).toBeTruthy();
  });

  it("filters to accountCount>0 rows when the Connected chip is active", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "key-connected", label: "KeyConnected", accountPool: "key-connected", sharedWith: [], pluginName: "key-connected", authKind: "api-key", accountCount: 1, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "key-unconnected", label: "KeyUnconnected", accountPool: "key-unconnected", sharedWith: [], pluginName: "key-unconnected", authKind: "api-key", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
    });

    const { getByText, queryByText, container } = render(Providers);
    await waitFor(() => expect(getByText("KeyConnected")).toBeTruthy());
    expect(getByText("KeyUnconnected")).toBeTruthy();

    const toolbar = within(container.querySelector(".toolbar")!);
    await fireEvent.click(toolbar.getByRole("button", { name: "Connected" }));

    await waitFor(() => expect(queryByText("KeyUnconnected")).toBeNull());
    expect(getByText("KeyConnected")).toBeTruthy();
  });

  it("Import opens the selective dialog for the single importable app, and shows its notes", async () => {
    const importApps = vi.fn(async () => ({
      ok: true,
      data: [{ app: "claude", label: "Claude Code", hasConfig: true }],
    }) as const);
    const importRun = vi.fn(async () => ({
      ok: true,
      data: { accounts: 1, providers: 2, routingImported: true, notes: ["exposed 2 provider(s) for Claude Code"] },
    }) as const);
    stubForebay({
      providersList: async () => ({ ok: true, data: [] }),
      importApps,
      importPreview: async () => ({ ok: true, data: { accounts: 1, routingSlots: 2, exposedProviders: 2 } }),
      importRun,
    });

    const { getByText, findByRole } = render(Providers);
    await waitFor(() => expect(getByText("Import")).toBeTruthy());

    await fireEvent.click(getByText("Import"));
    expect(importApps).toHaveBeenCalled();

    const dialog = await findByRole("dialog");
    await fireEvent.click(within(dialog).getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(importRun).toHaveBeenCalledWith("claude", { accounts: true, routing: true, exposure: true }));
    await waitFor(() => expect(getByText(/exposed 2 provider\(s\) for Claude Code/i)).toBeTruthy());
  });

  it("Import navigates to Apps when more than one app is importable", async () => {
    stubForebay({
      providersList: async () => ({ ok: true, data: [] }),
      importApps: async () => ({
        ok: true,
        data: [
          { app: "claude", label: "Claude Code", hasConfig: true },
          { app: "opencode", label: "OpenCode", hasConfig: true },
        ],
      }),
    });
    router.set({ screen: "providers" });

    const { getByText } = render(Providers);
    await waitFor(() => expect(getByText("Import")).toBeTruthy());
    await fireEvent.click(getByText("Import"));

    await waitFor(() => expect(get(router).screen).toBe("apps"));
  });

  it("+ Add provider navigates to Plugins with deep-link params", async () => {
    stubForebay({ providersList: async () => ({ ok: true, data: [] }) });
    router.set({ screen: "providers" });

    const { getByText } = render(Providers);
    await waitFor(() => expect(getByText("+ Add provider")).toBeTruthy());
    await fireEvent.click(getByText("+ Add provider"));

    expect(get(router).screen).toBe("plugins");
    const params = consumeParams();
    expect(params).toEqual({ kind: "provider" });
  });

  it("filters rows by id or by label as the debounced search settles", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "gamma-id", label: "Alpha Label", accountPool: "gamma-id", sharedWith: [], pluginName: "gamma-id", authKind: "api-key", accountCount: 1, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "beta-id", label: "Zeta Label", accountPool: "beta-id", sharedWith: [], pluginName: "beta-id", authKind: "api-key", accountCount: 1, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
    });

    const { getByPlaceholderText, getByText, queryByText } = render(Providers);
    await waitFor(() => expect(getByText("Alpha Label")).toBeTruthy());

    const input = getByPlaceholderText("Search providers");

    await fireEvent.input(input, { target: { value: "beta-id" } });
    await waitFor(() => expect(queryByText("Alpha Label")).toBeNull(), { timeout: 1000 });
    expect(getByText("Zeta Label")).toBeTruthy();

    await fireEvent.input(input, { target: { value: "Alpha Label" } });
    await waitFor(() => expect(getByText("Alpha Label")).toBeTruthy(), { timeout: 1000 });
    expect(queryByText("Zeta Label")).toBeNull();
  });

  it("virtualizes a group once its row count exceeds the threshold", async () => {
    const data = Array.from({ length: 25 }, (_, i) => ({
      id: `provider-${i}`,
      label: `Provider ${i}`,
      accountPool: `provider-${i}`,
      sharedWith: [],
      pluginName: `provider-${i}`,
      authKind: "api-key" as const,
      accountCount: 1,
      enabled: true,
      exposure: { claude: false, opencode: false },
    }));
    stubForebay({ providersList: async () => ({ ok: true, data }) });

    const { getByText, container } = render(Providers);
    await waitFor(() => expect(getByText("Provider 0")).toBeTruthy());

    const groupButtons = Array.from(container.querySelectorAll("button.hd"));
    const connectedButton = groupButtons.find((b) => b.querySelector(".lbl")?.textContent === "Connected");
    expect(connectedButton?.querySelector(".cnt")?.textContent).toBe("25");

    const renderedRows = container.querySelectorAll("[data-testid^='provider-']").length;
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(25);
  });

  it("shows the provider's translator as a chip", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "custom", label: "Custom endpoint", accountPool: "custom", sharedWith: [], pluginName: "custom", authKind: "api-key", accountCount: 1, enabled: false, exposure: { claude: true, opencode: false }, translator: "gemini" },
        ],
      }),
    });

    const { findByText } = render(Providers);
    expect(await findByText("gemini")).toBeTruthy();
  });

  it("shows the provider id beside a display name that differs from it", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "gemini-cli", label: "Gemini CLI", accountPool: "antigravity", sharedWith: [], pluginName: "antigravity-auth", authKind: "oauth", accountCount: 1, enabled: true, exposure: { claude: true, opencode: true } },
        ],
      }),
    });

    const { findByText } = render(Providers);
    expect(await findByText("Gemini CLI")).toBeTruthy();
    expect(await findByText("gemini-cli")).toBeTruthy();
  });

  it("says a provider whose bundle failed to load will not load, and why", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "half-built", label: "half-built", accountPool: "half-built", sharedWith: [], pluginName: "half-built-auth", authKind: "api-key", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false }, defsError: "Cannot find package '@intisy-ai/basekit/auth'" },
        ],
      }),
    });

    const { findByText } = render(Providers);
    const pill = await findByText("Won't load");
    expect(pill.getAttribute("title")).toContain("half-built-auth failed to load");
    expect(pill.getAttribute("title")).toContain("@intisy-ai/basekit/auth");
  });

  it("opens the custom endpoints dialog from the toolbar", async () => {
    stubForebay({ providersList: async () => ({ ok: true, data: [] }), customEndpointsList: async () => ({ ok: true, data: [] }) });
    const { findByRole } = render(Providers);
    await fireEvent.click(await findByRole("button", { name: /custom endpoints/i }));
    expect(await findByRole("dialog", { name: /custom endpoints/i })).toBeInTheDocument();
  });

  it("collapsing the Available group hides its rows", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "avail", label: "Available Provider", accountPool: "avail", sharedWith: [], pluginName: "avail", authKind: "api-key", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
    });

    const { getByText, queryByText, container } = render(Providers);
    await waitFor(() => expect(getByText("Available Provider")).toBeTruthy());

    const groupButtons = Array.from(container.querySelectorAll("button.hd"));
    const availableButton = groupButtons.find((b) => b.querySelector(".lbl")?.textContent === "Available")!;
    await fireEvent.click(availableButton);

    await waitFor(() => expect(queryByText("Available Provider")).toBeNull());
  });

  it("toasts an error when setting a provider enabled fails, without a success toast", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
      providersSetEnabled: async () => ({ ok: false, error: "set-enabled boom" }),
    });

    const { getByRole } = render(Providers);
    const enabledSwitch = await waitFor(() => getByRole("switch", { name: /Stub enabled/i }));
    await fireEvent.click(enabledSwitch);

    await waitFor(() => expect(get(toasts).some((t) => t.kind === "error" && t.message === "set-enabled boom")).toBe(true));
    expect(get(toasts).some((t) => t.kind === "success")).toBe(false);
  });

  it("shows a loading skeleton before providers resolve, then content", async () => {
    let resolveProviders!: (v: { ok: true; data: [] }) => void;
    const pending = new Promise<{ ok: true; data: [] }>((r) => (resolveProviders = r));
    stubForebay({
      providersList: () => pending,
      appsList: async () => ({ ok: true, data: [] }),
    });
    const { getAllByTestId, queryAllByTestId } = render(Providers);

    expect(getAllByTestId("skeleton").length).toBeGreaterThan(0);
    resolveProviders({ ok: true, data: [] });
    await waitFor(() => expect(queryAllByTestId("skeleton").length).toBe(0));
  });

  it("renders a view toggle and starts in grid mode when that is the stored preference, showing compact provider cards", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
      getConfig: async () => ({ ok: true, data: "grid" }),
    });

    render(Providers);

    expect(await screen.findByRole("button", { name: "Grid view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List view" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("providers-grid")).toBeInTheDocument());
    const grid = within(screen.getByTestId("providers-grid"));
    expect(grid.getByText("Stub")).toBeInTheDocument();
    expect(grid.getByText(/2 accounts/i)).toBeInTheDocument();
    expect(grid.getByRole("switch", { name: /Stub enabled/i })).toBeInTheDocument();
  });

  it("grid mode renders a provider's real icon instead of a lettermark", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false }, icon: "data:image/svg+xml;base64,abc" },
        ],
      }),
      getConfig: async () => ({ ok: true, data: "grid" }),
    });

    render(Providers);

    const card = await waitFor(() => screen.getByTestId("provider-stub"));
    const icon = card.querySelector("img.icon") as HTMLImageElement | null;
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("src")).toBe("data:image/svg+xml;base64,abc");
    expect(card.querySelector(".lettermark")).toBeNull();
  });

  it("grid mode falls back to a lettermark when a provider carries no icon", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
      getConfig: async () => ({ ok: true, data: "grid" }),
    });

    render(Providers);

    const card = await waitFor(() => screen.getByTestId("provider-stub"));
    expect(card.querySelector("img.icon")).toBeNull();
    const mark = card.querySelector(".lettermark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("S");
  });

  it("switches back to list view and persists the choice", async () => {
    const setConfig = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
      getConfig: async () => ({ ok: true, data: "grid" }),
      setConfig,
    });

    render(Providers);

    await waitFor(() => expect(screen.getByTestId("providers-grid")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("button", { name: "List view" }));

    await waitFor(() => expect(screen.queryByTestId("providers-grid")).toBeNull());
    expect(screen.getByText("Stub")).toBeInTheDocument();
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith("forebay", "viewMode.providers", "list"));
  });

  it("grid mode's enable switch reuses the same providersSetEnabled wiring", async () => {
    const providersSetEnabled = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
      getConfig: async () => ({ ok: true, data: "grid" }),
      providersSetEnabled,
    });

    render(Providers);

    const enabledSwitch = await waitFor(() => screen.getByRole("switch", { name: /Stub enabled/i }));
    await fireEvent.click(enabledSwitch);

    await waitFor(() => expect(providersSetEnabled).toHaveBeenCalledWith("stub", false));
  });

  it("enabling one provider does not touch another provider's enabled call", async () => {
    const providersSetEnabled = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "alpha", label: "Alpha", accountPool: "alpha", sharedWith: [], pluginName: "alpha", authKind: "oauth", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
          { id: "beta", label: "Beta", accountPool: "beta", sharedWith: [], pluginName: "beta", authKind: "oauth", accountCount: 0, enabled: false, exposure: { claude: false, opencode: false } },
        ],
      }),
      providersSetEnabled,
    });

    const { getByRole } = render(Providers);
    const alphaSwitch = await waitFor(() => getByRole("switch", { name: /Alpha enabled/i }));
    await fireEvent.click(alphaSwitch);

    await waitFor(() => expect(providersSetEnabled).toHaveBeenCalledWith("alpha", true));
    expect(providersSetEnabled).not.toHaveBeenCalledWith("beta", expect.anything());
  });

  it("clicking a provider row opens its detail modal", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
    });

    const { getByText, findByRole } = render(Providers);
    await waitFor(() => expect(getByText("Stub")).toBeTruthy());

    await fireEvent.click(getByText("Stub"));

    const dialog = await findByRole("dialog", { name: /Stub details/i });
    expect(dialog).toBeTruthy();
  });

  it("clicking the enable toggle does not open the detail modal", async () => {
    stubForebay({
      providersList: async () => ({
        ok: true,
        data: [
          { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub", authKind: "oauth", accountCount: 2, enabled: true, exposure: { claude: true, opencode: false } },
        ],
      }),
    });

    const { getByRole, queryByRole } = render(Providers);
    const enabledSwitch = await waitFor(() => getByRole("switch", { name: /Stub enabled/i }));
    await fireEvent.click(enabledSwitch);

    expect(queryByRole("dialog", { name: /Stub details/i })).toBeNull();
  });
});
