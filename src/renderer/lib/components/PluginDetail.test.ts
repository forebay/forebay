// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import { seedJobsForTest, resetDownloadsForTest } from "../downloads.js";
import PluginDetail from "./PluginDetail.svelte";
import type { UnifiedPlugin, PluginVersion } from "@forebay/shared";

const PLUGIN: UnifiedPlugin = {
  name: "wakatime-sync",
  kind: "plugin",
  description: "Tracks time",
  url: "https://github.com/forebay/wakatime-sync",
  updateAvailable: true,
  homes: { claude: { installed: true }, opencode: { installed: true } },
  topics: [],
  displayName: "wakatime-sync",
  icon: "",
  external: false,
  favorite: false,
};

function version(overrides: Partial<PluginVersion> = {}): PluginVersion {
  return {
    kind: "git",
    label: "v1.0.0",
    updateState: "current",
    autoUpdate: true,
    onExperimental: false,
    experimentalAvailable: null,
    ...overrides,
  };
}

function props(homes: { id: string; label: string; managesPlugins?: boolean }[]) {
  return {
    plugin: PLUGIN,
    homes,
    onClose: vi.fn(),
    onInstallAll: vi.fn(),
    onRemoveEverywhere: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateHome: vi.fn(async () => {}),
    onToggleHome: vi.fn(),
  };
}

// The detail view opens on the readme; the per-home list lives behind its own tab.
async function openMenuIn(label: string) {
  const scope = within(row(label));
  await fireEvent.click(scope.getByRole("button", { name: "More install options" }));
  return scope;
}

async function openAvailability(homes: { id: string; label: string; managesPlugins?: boolean }[]): Promise<void> {
  render(PluginDetail, { props: props(homes) });
  await fireEvent.click(await screen.findByRole("button", { name: "Availability" }));
}

// Each home is one row of the availability list; the split button above it can carry an
// "Update" of its own, so every assertion here is scoped to the row it is about.
function row(label: string): HTMLElement {
  const item = screen.getAllByRole("listitem").find((li) => li.textContent?.includes(label));
  if (!item) throw new Error(`no availability row for ${label}`);
  return item;
}

describe("PluginDetail availability", () => {
  // An update being available is not a reason to take removal away from the user.
  it("offers Update AND Remove for the home that is behind", async () => {
    stubForebay({
      pluginVersions: async () => ({ ok: true, data: { claude: version({ updateState: "behind" }), opencode: version() } }),
    });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: true }, { id: "opencode", label: "OpenCode", managesPlugins: true }]);

    // A behind home leads with Update and says so; Remove stays reachable in its dropdown.
    await waitFor(() => expect(within(row("Claude Code")).getByRole("button", { name: "Update" })).toBeInTheDocument());
    expect(within(row("Claude Code")).getByTestId("behind-claude")).toBeInTheDocument();
    expect((await openMenuIn("Claude Code")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(row("OpenCode")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(row("OpenCode")).queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("keeps Remove for a home that is up to date", async () => {
    stubForebay({ pluginVersions: async () => ({ ok: true, data: { claude: version(), opencode: version() } }) });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: true }, { id: "opencode", label: "OpenCode", managesPlugins: true }]);

    await waitFor(() => expect(within(row("Claude Code")).getByRole("button", { name: "Remove" })).toBeInTheDocument());
    expect(within(row("Claude Code")).queryByRole("button", { name: "Update" })).toBeNull();
    expect(within(row("OpenCode")).queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("shows no update or auto-update control for a home with no updater", async () => {
    stubForebay({
      pluginVersions: async () => ({ ok: true, data: { claude: version({ updateState: "behind" }), opencode: version({ updateState: "behind" }) } }),
    });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: false }, { id: "opencode", label: "OpenCode", managesPlugins: false }]);

    await waitFor(() => expect(within(row("Claude Code")).getByRole("button", { name: "Remove" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("group", { name: /Auto-update/ })).toBeNull();
  });

  it("offers the auto-update control where an updater manages the plugin", async () => {
    stubForebay({ pluginVersions: async () => ({ ok: true, data: { claude: version() } }) });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: true }]);

    const group = await screen.findByRole("group", { name: "Auto-update Claude Code" });
    expect(within(group).getByRole("button", { name: "Auto-update Claude Code on" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Auto-update Claude Code off" })).toBeInTheDocument();
  });
});

// The ledger keys a row by the plugin's manifest id, which is not always the entry name
// (PLUGIN.name) the plugins.json row and the catalog use. A join on the wrong space renders
// "Not loaded in any home" for a plugin that is actually loaded and healthy.
describe("PluginDetail developer tab", () => {
  it("matches the ledger by the plugin's resolved id rather than its entry name", async () => {
    stubForebay({
      pluginVersions: async () => ({ ok: true, data: { claude: version() } }),
      pluginLedger: async () => ({
        ok: true,
        data: [{
          home: { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true },
          rows: [{
            pluginId: "wakatime-sync-host-id", status: "active",
            capabilitiesDeclared: [], capabilities: [], provides: [], consumes: [], unresolved: [], topics: [], permissions: [],
          }],
        }],
      }),
    });
    render(PluginDetail, {
      props: { ...props([{ id: "claude", label: "Claude Code", managesPlugins: true }]), plugin: { ...PLUGIN, pluginId: "wakatime-sync-host-id" } },
    });
    await fireEvent.click(await screen.findByRole("button", { name: "Developer" }));
    expect(await screen.findByText("No capabilities declared.")).toBeInTheDocument();
    expect(screen.queryByText(/not loaded in any home/i)).toBeNull();
  });

  it("says not loaded when no ledger row matches the resolved id", async () => {
    stubForebay({
      pluginVersions: async () => ({ ok: true, data: { claude: version() } }),
      pluginLedger: async () => ({
        ok: true,
        data: [{
          home: { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true },
          rows: [{
            pluginId: "some-other-plugin", status: "active",
            capabilitiesDeclared: [], capabilities: [], provides: [], consumes: [], unresolved: [], topics: [], permissions: [],
          }],
        }],
      }),
    });
    render(PluginDetail, {
      props: { ...props([{ id: "claude", label: "Claude Code", managesPlugins: true }]), plugin: { ...PLUGIN, pluginId: "wakatime-sync-host-id" } },
    });
    await fireEvent.click(await screen.findByRole("button", { name: "Developer" }));
    expect(await screen.findByText(/not loaded in any home/i)).toBeInTheDocument();
  });
});

describe("PluginDetail settings loading", () => {
  it("fetches no schema while the Configure tab is closed", async () => {
    const configSchemas = vi.fn(async () => ({ ok: true as const, data: [] }));
    stubForebay({ pluginVersions: async () => ({ ok: true, data: { claude: version() } }), configSchemas });
    render(PluginDetail, { props: props([{ id: "claude", label: "Claude Code", managesPlugins: true }]) });

    await screen.findByRole("button", { name: "Availability" });
    await new Promise((r) => setTimeout(r, 20));
    expect(configSchemas).not.toHaveBeenCalled();
  });

  it("fetches the schema once the Configure tab is opened", async () => {
    const configSchemas = vi.fn(async () => ({ ok: true as const, data: [] }));
    stubForebay({ pluginVersions: async () => ({ ok: true, data: { claude: version() } }), configSchemas });
    render(PluginDetail, { props: props([{ id: "claude", label: "Claude Code", managesPlugins: true }]) });

    await fireEvent.click(await screen.findByRole("button", { name: "Configure" }));
    await waitFor(() => expect(configSchemas).toHaveBeenCalledWith("claude"));
  });

  it("shows this home's own job state, not a flag shared across homes", async () => {
    seedJobsForTest([{
      id: "j1", kind: "install", plugin: "wakatime-sync", url: "u", home: "opencode",
      status: "queued", phase: "", percent: -1, phases: [], samples: [], queuedAt: 0,
    }]);
    stubForebay({ pluginVersions: async () => ({ ok: true, data: { claude: version(), opencode: version() } }) });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: true }, { id: "opencode", label: "OpenCode", managesPlugins: true }]);

    await waitFor(() => expect(within(row("OpenCode")).getByTestId("job-opencode")).toHaveTextContent("queued"));
    expect(within(row("Claude Code")).queryByTestId("job-claude")).toBeNull();
    // The row is busy, so it offers cancelling rather than another install.
    expect(within(row("OpenCode")).queryByRole("button", { name: "Remove" })).toBeNull();
    expect((await openMenuIn("OpenCode")).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    resetDownloadsForTest();
  });

  it("says the update state is unknown rather than implying it is current", async () => {
    stubForebay({ pluginVersions: async () => ({ ok: true, data: { claude: version({ updateState: "unknown", checkedAt: null }), opencode: version() } }) });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: true }, { id: "opencode", label: "OpenCode", managesPlugins: true }]);

    await waitFor(() => expect(within(row("Claude Code")).getByText("update state unknown")).toBeInTheDocument());
    expect(within(row("OpenCode")).queryByText("update state unknown")).toBeNull();
    // Unknown is not "behind", so it must not offer an update it cannot justify.
    expect(within(row("Claude Code")).queryByRole("button", { name: "Update" })).toBeNull();
  });

  // Installing everywhere queues every home at once, so a row that is waiting must say so
  // rather than still offering Install.
  it("shows a queued home as queued, not as installable", async () => {
    seedJobsForTest([
      { id: "j1", kind: "install", plugin: "wakatime-sync", url: "u", home: "claude", status: "running", phase: "downloading", percent: 10, phases: [], samples: [], queuedAt: 0 },
      { id: "j2", kind: "install", plugin: "wakatime-sync", url: "u", home: "opencode", status: "queued", phase: "", percent: -1, phases: [], samples: [], queuedAt: 1 },
    ]);
    stubForebay({ pluginVersions: async () => ({ ok: true, data: {} }) });
    await openAvailability([{ id: "claude", label: "Claude Code", managesPlugins: true }, { id: "opencode", label: "OpenCode", managesPlugins: true }]);

    await waitFor(() => expect(within(row("Claude Code")).getByTestId("job-claude")).toHaveTextContent("installing"));
    expect(within(row("OpenCode")).getByTestId("job-opencode")).toHaveTextContent("queued");
    expect(within(row("OpenCode")).queryByRole("button", { name: "Install" })).toBeNull();
    resetDownloadsForTest();
  });
});
