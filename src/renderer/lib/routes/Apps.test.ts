// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { router } from "../router.js";
import Apps from "./Apps.svelte";

const TWO_APPS = {
  appsList: async () =>
    ({
      ok: true,
      data: [
        { id: "claude", label: "Claude Code" },
        { id: "opencode", label: "OpenCode" },
      ],
    }) as const,
};

type ConnState = { cliPresent: boolean; loaderId: string | null; loaderInstalled: boolean };

function connections(byApp: Record<string, ConnState>) {
  return async (app: string) => ({ ok: true, data: { app, loaderUrl: null, ...byApp[app] } }) as const;
}

const SUMMARY = {
  ok: true,
  data: {
    accounts: [],
    providerCount: 2,
    accountsEnabled: 1,
    providerBreakdown: [],
    quotaMinPct: null,
    configDir: "/home/jane/.claude",
    pluginCount: 3,
    routingSlots: null,
  },
} as const;

const CONNECTED = connections({
  claude: { cliPresent: true, loaderId: "claude-code-loader", loaderInstalled: true },
  opencode: { cliPresent: false, loaderId: "opencode-loader", loaderInstalled: false },
});

describe("Apps screen", () => {
  it("renders one row per host app and no forebay row", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED });
    render(Apps);
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.queryByText("Forebay")).toBeNull();
  });

  it("shows the connection status per app from its chain state", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED });
    render(Apps);
    const claude = within(await screen.findByTestId("app-claude"));
    const opencode = within(await screen.findByTestId("app-opencode"));
    expect(claude.getByText("Connected")).toBeInTheDocument();
    expect(opencode.getByText("Not detected")).toBeInTheDocument();
  });

  it("opens a lazily-loaded detail when a row is clicked", async () => {
    const appsSummary = vi.fn(async () => SUMMARY);
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED, appsSummary });
    render(Apps);

    const claudeCard = within(await screen.findByTestId("app-claude"));
    expect(appsSummary).not.toHaveBeenCalled();

    await fireEvent.click(claudeCard.getByText("Claude Code"));

    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByTestId("stat-providers")).toHaveTextContent(/2\s*providers/i));
    expect(dialog.getByTestId("stat-plugins")).toHaveTextContent(/3\s*plugins/i);
    expect(appsSummary).toHaveBeenCalledWith("claude");
  });

  it("connects an app with a loader by installing the loader", async () => {
    const appsInstallLoader = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED, appsInstallLoader });
    render(Apps);

    const opencode = within(await screen.findByTestId("app-opencode"));
    await fireEvent.click(opencode.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(appsInstallLoader).toHaveBeenCalledWith("opencode"));
  });

  it("offers Install loader when the CLI is present but the loader is missing", async () => {
    const appsInstallLoader = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      ...TWO_APPS,
      appsConnection: connections({
        claude: { cliPresent: true, loaderId: "claude-code-loader", loaderInstalled: true },
        opencode: { cliPresent: true, loaderId: "opencode-loader", loaderInstalled: false },
      }),
      appsInstallLoader,
    });
    render(Apps);

    const opencode = within(await screen.findByTestId("app-opencode"));
    await fireEvent.click(opencode.getByRole("button", { name: "Install loader" }));

    await waitFor(() => expect(appsInstallLoader).toHaveBeenCalledWith("opencode"));
  });

  it("installs the CLI directly for an app that declares no loader", async () => {
    const appsInstallCli = vi.fn(async () => ({ ok: true, data: { stdout: "", stderr: "" } }) as const);
    stubForebay({
      ...TWO_APPS,
      appsConnection: connections({
        claude: { cliPresent: true, loaderId: null, loaderInstalled: false },
        opencode: { cliPresent: false, loaderId: null, loaderInstalled: false },
      }),
      appsInstallCli,
    });
    render(Apps);

    const opencode = within(await screen.findByTestId("app-opencode"));
    await fireEvent.click(opencode.getByRole("button", { name: "Install CLI" }));

    await waitFor(() => expect(appsInstallCli).toHaveBeenCalledWith("opencode"));
  });

  it("uninstalls a connected app after confirmation", async () => {
    const appsUninstallCli = vi.fn(async () => ({ ok: true, data: { stdout: "", stderr: "" } }) as const);
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED, appsUninstallCli });
    render(Apps);

    const claudeCard = within(await screen.findByTestId("app-claude"));
    await fireEvent.click(claudeCard.getByRole("button", { name: "Uninstall" }));

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Uninstall" }));

    await waitFor(() => expect(appsUninstallCli).toHaveBeenCalledWith("claude", false));
  });

  it("offers Import config in the detail of an app with importable config and opens the dialog", async () => {
    const importPreview = vi.fn(async () => ({
      ok: true,
      data: { accounts: 2, routingSlots: 1, exposedProviders: 3 },
    }) as const);
    stubForebay({
      ...TWO_APPS,
      appsConnection: connections({
        claude: { cliPresent: true, loaderId: "claude-code-loader", loaderInstalled: true },
        opencode: { cliPresent: true, loaderId: "opencode-loader", loaderInstalled: true },
      }),
      appsSummary: async () => SUMMARY,
      importApps: async () => ({
        ok: true,
        data: [
          { app: "claude", label: "Claude Code", hasConfig: true },
          { app: "opencode", label: "OpenCode", hasConfig: false },
        ],
      }),
      importPreview,
    });
    render(Apps);

    const claudeCard = within(await screen.findByTestId("app-claude"));
    await fireEvent.click(claudeCard.getByText("Claude Code"));

    const dialog = within(await screen.findByRole("dialog"));
    const importButton = await dialog.findByRole("button", { name: /import config/i });
    await fireEvent.click(importButton);
    await waitFor(() => expect(importPreview).toHaveBeenCalledWith("claude"));
  });

  it("does not offer Import config for an app without importable config", async () => {
    stubForebay({
      ...TWO_APPS,
      appsConnection: connections({
        claude: { cliPresent: false, loaderId: "claude-code-loader", loaderInstalled: false },
        opencode: { cliPresent: true, loaderId: "opencode-loader", loaderInstalled: true },
      }),
      appsSummary: async () => SUMMARY,
      importApps: async () => ({
        ok: true,
        data: [{ app: "opencode", label: "OpenCode", hasConfig: false }],
      }),
    });
    render(Apps);

    const opencodeCard = within(await screen.findByTestId("app-opencode"));
    await fireEvent.click(opencodeCard.getByText("OpenCode"));

    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByTestId("stat-providers")).toBeInTheDocument());
    expect(dialog.queryByRole("button", { name: /import config/i })).toBeNull();
  });

  it("shows the integration chain and status in the detail", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED, appsSummary: async () => SUMMARY });
    render(Apps);

    const claudeCard = within(await screen.findByTestId("app-claude"));
    await fireEvent.click(claudeCard.getByText("Claude Code"));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Command line")).toBeInTheDocument();
    expect(dialog.getByText("Loader")).toBeInTheDocument();
    // The Local API is offered as an alternative, not a chain step.
    expect(dialog.getByText(/Connect this app through the Local API/)).toBeInTheDocument();
  });

  it("navigates to the Local API from the detail's alternative link", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED, appsSummary: async () => SUMMARY });
    router.set({ screen: "apps" });
    render(Apps);

    const claudeCard = within(await screen.findByTestId("app-claude"));
    await fireEvent.click(claudeCard.getByText("Claude Code"));

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByText(/Connect this app through the Local API/));
    expect(get(router).screen).toBe("localApi");
  });

  it("renders a view toggle and starts in grid mode when that is the stored preference", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED, getConfig: async () => ({ ok: true, data: "grid" }) });
    render(Apps);

    expect(await screen.findByRole("button", { name: "Grid view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List view" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("apps-grid")).toBeInTheDocument());
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
  });

  it("switches back to list view and persists the choice", async () => {
    const setConfig = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      ...TWO_APPS,
      appsConnection: CONNECTED,
      getConfig: async () => ({ ok: true, data: "grid" }),
      setConfig,
    });
    render(Apps);

    await waitFor(() => expect(screen.getByTestId("apps-grid")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("button", { name: "List view" }));

    await waitFor(() => expect(screen.getByTestId("apps-list")).toBeInTheDocument());
    expect(screen.queryByTestId("apps-grid")).toBeNull();
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith("forebay", "viewMode.apps", "list"));
  });

  it("filters the list by name and by loader", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED });
    render(Apps);
    await screen.findByTestId("app-claude");

    const field = screen.getByLabelText("Search apps");
    await fireEvent.input(field, { target: { value: "opencode" } });
    await waitFor(() => expect(screen.queryByTestId("app-claude")).toBeNull());
    expect(screen.getByTestId("app-opencode")).toBeInTheDocument();

    await fireEvent.input(field, { target: { value: "claude-code-loader" } });
    await waitFor(() => expect(screen.getByTestId("app-claude")).toBeInTheDocument());
    expect(screen.queryByTestId("app-opencode")).toBeNull();
  });

  it("offers a way back when the search matches nothing", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED });
    render(Apps);
    await screen.findByTestId("app-claude");

    await fireEvent.input(screen.getByLabelText("Search apps"), { target: { value: "nothing-here" } });
    const clear = await screen.findByRole("button", { name: "Clear search" });

    await fireEvent.click(clear);
    await waitFor(() => expect(screen.getByTestId("app-claude")).toBeInTheDocument());
  });

  it("reports how many apps are connected", async () => {
    stubForebay({ ...TWO_APPS, appsConnection: CONNECTED });
    render(Apps);
    expect(await screen.findByText(/1 of 2 connected/i)).toBeInTheDocument();
  });
});
