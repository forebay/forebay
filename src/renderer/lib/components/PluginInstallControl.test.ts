// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import PluginInstallControl from "./PluginInstallControl.svelte";
import type { UnifiedPlugin } from "@forebay/shared";

const HOMES = [
  { id: "claude", label: "Claude Code" },
  { id: "opencode", label: "OpenCode" },
];

function plugin(installedIn: string[]): UnifiedPlugin {
  return {
    name: "wakatime-sync",
    kind: "plugin",
    description: "",
    updateAvailable: false,
    homes: Object.fromEntries(HOMES.map((h) => [h.id, { installed: installedIn.includes(h.id) }])),
    topics: [],
    displayName: "wakatime-sync",
    icon: "",
    external: false,
    favorite: false,
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    plugin: plugin(["claude", "opencode"]),
    homes: HOMES,
    onInstallAll: vi.fn(),
    onRemoveEverywhere: vi.fn(),
    onToggleHome: vi.fn(),
    ...overrides,
  };
}

async function openMenu(): Promise<void> {
  await fireEvent.click(screen.getByRole("button", { name: "More install options" }));
}

describe("PluginInstallControl", () => {
  it("offers Remove everywhere as the primary action when everything is installed", () => {
    render(PluginInstallControl, { props: props() });
    expect(screen.getByRole("button", { name: "Remove everywhere" })).toBeInTheDocument();
  });

  // "everywhere" is one app for a loader, which only ever serves the app that names it.
  it("names the single app instead of saying everywhere when only one applies", () => {
    render(PluginInstallControl, {
      props: {
        ...props(),
        homes: [{ id: "claude", label: "Claude Code" }],
        plugin: { ...plugin(["claude"]), homes: { claude: { installed: true } } },
      },
    });
    expect(screen.getByRole("button", { name: "Remove from Claude Code" })).toBeInTheDocument();
  });

  // A half-built copy is broken now, so repairing it comes before updating or removing.
  it("offers Repair ahead of everything else when a copy is only partly built", async () => {
    const onRepairHome = vi.fn();
    render(PluginInstallControl, {
      props: props({ updateAvailable: true, updatesEnabled: true, onUpdate: vi.fn(), onRepairHome, brokenHomes: ["claude"] }),
    });
    await fireEvent.click(screen.getByRole("button", { name: "Repair in Claude Code" }));
    expect(onRepairHome).toHaveBeenCalledWith("claude");
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });

  it("keeps updating and removing in the menu while the primary offers a repair", async () => {
    render(PluginInstallControl, {
      props: props({ updateAvailable: true, updatesEnabled: true, onUpdate: vi.fn(), onUpdateHome: vi.fn(), onRepairHome: vi.fn(), behindHomes: ["claude"], brokenHomes: ["claude"] }),
    });
    await openMenu();
    expect(screen.getByRole("button", { name: "Update in Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove everywhere" })).toBeInTheDocument();
  });

  it("ignores a broken home the plugin is not installed in", () => {
    render(PluginInstallControl, {
      props: props({ plugin: plugin(["claude"]), onRepairHome: vi.fn(), brokenHomes: ["opencode"] }),
    });
    expect(screen.getByRole("button", { name: "Install in OpenCode" })).toBeInTheDocument();
  });

  // A copy that is behind is the broken thing here; installing into a home that simply has
  // not got it yet can wait for the menu.
  it("offers Update ahead of installing into the homes still missing it", async () => {
    const onUpdate = vi.fn();
    render(PluginInstallControl, {
      props: props({ plugin: plugin(["claude"]), updateAvailable: true, updatesEnabled: true, onUpdate }),
    });
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Install in/ })).not.toBeInTheDocument();
    await openMenu();
    expect(screen.getByRole("button", { name: "Install in OpenCode" })).toBeInTheDocument();
  });

  it("still offers Install as the primary action when nothing installed is behind", () => {
    render(PluginInstallControl, {
      props: props({ plugin: plugin(["claude"]), updateAvailable: false, updatesEnabled: true, onUpdate: vi.fn() }),
    });
    expect(screen.getByRole("button", { name: "Install in OpenCode" })).toBeInTheDocument();
  });

  it("offers Install as the primary action when the plugin is nowhere yet, update or not", () => {
    render(PluginInstallControl, {
      props: props({ plugin: plugin([]), updateAvailable: true, updatesEnabled: true, onUpdate: vi.fn() }),
    });
    expect(screen.getByRole("button", { name: "Install everywhere" })).toBeInTheDocument();
  });

  it("offers Update in place of Remove everywhere once an update is detected", () => {
    const onUpdate = vi.fn();
    render(PluginInstallControl, { props: props({ updateAvailable: true, updatesEnabled: true, onUpdate }) });

    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove everywhere" })).toBeNull();
  });

  it("runs the update when that primary button is pressed", async () => {
    const onUpdate = vi.fn();
    const onRemoveEverywhere = vi.fn();
    render(PluginInstallControl, { props: props({ updateAvailable: true, updatesEnabled: true, onUpdate, onRemoveEverywhere }) });

    await fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onRemoveEverywhere).not.toHaveBeenCalled();
  });

  // Swapping the primary button must not cost the user the ability to remove the plugin.
  it("keeps removal reachable in the menu while the primary shows Update", async () => {
    render(PluginInstallControl, { props: props({ updateAvailable: true, updatesEnabled: true, onUpdate: vi.fn() }) });
    await openMenu();

    expect(screen.getByRole("button", { name: "Remove everywhere" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from OpenCode" })).toBeInTheDocument();
  });

  it("offers a per-home update in the menu when only some homes are behind", async () => {
    const onUpdateHome = vi.fn();
    render(PluginInstallControl, {
      props: props({
        plugin: plugin(["claude"]),
        updateAvailable: true,
        updatesEnabled: true,
        behindHomes: ["claude"],
        onUpdate: vi.fn(),
        onUpdateHome,
      }),
    });
    await openMenu();

    await fireEvent.click(screen.getByRole("button", { name: "Update in Claude Code" }));
    expect(onUpdateHome).toHaveBeenCalledWith("claude");
    expect(screen.queryByRole("button", { name: "Update in OpenCode" })).toBeNull();
  });

  it("shows no update affordance at all when no updater manages this plugin", async () => {
    render(PluginInstallControl, { props: props({ updateAvailable: true, updatesEnabled: false, onUpdate: vi.fn() }) });

    expect(screen.getByRole("button", { name: "Remove everywhere" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    await openMenu();
    expect(screen.queryByRole("button", { name: /^Update in/ })).toBeNull();
  });

  it("gathers the remaining homes into one menu entry when several are missing it", async () => {
    render(PluginInstallControl, {
      props: {
        ...props({ plugin: plugin([]), updateAvailable: true, updatesEnabled: true, onUpdate: vi.fn() }),
        homes: [...HOMES, { id: "forebay", label: "Forebay" }],
        plugin: { ...plugin(["claude"]), homes: { claude: { installed: true }, opencode: { installed: false }, forebay: { installed: false } } },
      },
    });
    await openMenu();
    expect(screen.getByRole("button", { name: "Install in 2 more" })).toBeInTheDocument();
  });
});
