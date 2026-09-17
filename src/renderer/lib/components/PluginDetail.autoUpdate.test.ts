// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import PluginDetail from "./PluginDetail.svelte";
import type { UnifiedPlugin } from "@forebay/shared";

const PLUGIN: UnifiedPlugin = {
  name: "wakatime-sync",
  kind: "plugin",
  description: "Tracks time",
  url: "https://github.com/forebay/wakatime-sync",
  updateAvailable: false,
  homes: { claude: { installed: true } },
  topics: [],
  displayName: "wakatime-sync",
  icon: "",
  external: false,
  favorite: false,
};

function baseProps(extra: Partial<Record<string, unknown>> = {}) {
  return {
    plugin: PLUGIN,
    homes: [{ id: "claude", label: "Claude Code", managesPlugins: true }],
    onClose: vi.fn(),
    onInstallAll: vi.fn(),
    onRemoveEverywhere: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateHome: vi.fn(async () => {}),
    onToggleHome: vi.fn(),
    ...extra,
  };
}

async function openAvailability(extra: Partial<Record<string, unknown>> = {}) {
  const utils = render(PluginDetail, { props: baseProps(extra) });
  await fireEvent.click(await utils.findByRole("button", { name: "Availability" }));
  return utils;
}

function stubVersions(autoUpdate: boolean) {
  stubForebay({
    pluginVersions: async () => ({
      ok: true,
      data: {
        claude: { kind: "git", label: "v1", updateState: "current", autoUpdate, onExperimental: false, experimentalAvailable: null },
      },
    }),
  });
}

describe("PluginDetail auto-update control", () => {
  it("renders On pressed for a plugin with auto-update enabled", async () => {
    stubVersions(true);
    const { findByRole } = await openAvailability();
    const on = await findByRole("button", { name: "Auto-update Claude Code on" });
    const off = await findByRole("button", { name: "Auto-update Claude Code off" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("aria-pressed")).toBe("false");
  });

  it("sends false when Off is picked", async () => {
    const pluginsSetAutoUpdate = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubVersions(true);
    stubForebay({
      pluginVersions: async () => ({
        ok: true,
        data: { claude: { kind: "git", label: "v1", updateState: "current", autoUpdate: true, onExperimental: false, experimentalAvailable: null } },
      }),
      pluginsSetAutoUpdate,
    });
    const { findByRole } = await openAvailability();
    await fireEvent.click(await findByRole("button", { name: "Auto-update Claude Code off" }));
    await waitFor(() => expect(pluginsSetAutoUpdate).toHaveBeenCalledWith("claude", "wakatime-sync", false));
  });

  it("sends true when On is picked", async () => {
    const pluginsSetAutoUpdate = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      pluginVersions: async () => ({
        ok: true,
        data: { claude: { kind: "git", label: "v1", updateState: "current", autoUpdate: false, onExperimental: false, experimentalAvailable: null } },
      }),
      pluginsSetAutoUpdate,
    });
    const { findByRole } = await openAvailability();
    await fireEvent.click(await findByRole("button", { name: "Auto-update Claude Code on" }));
    await waitFor(() => expect(pluginsSetAutoUpdate).toHaveBeenCalledWith("claude", "wakatime-sync", true));
  });

  // This is the case the optimistic control must undo: without a revert, a failed write left
  // the control showing a state the disk was never moved to.
  it("reverts to the previous selection when the write fails", async () => {
    const pluginsSetAutoUpdate = vi.fn(async () => ({ ok: false, error: "denied" }) as const);
    stubForebay({
      pluginVersions: async () => ({
        ok: true,
        data: { claude: { kind: "git", label: "v1", updateState: "current", autoUpdate: true, onExperimental: false, experimentalAvailable: null } },
      }),
      pluginsSetAutoUpdate,
    });
    const { findByRole } = await openAvailability();
    const on = await findByRole("button", { name: "Auto-update Claude Code on" });
    const off = await findByRole("button", { name: "Auto-update Claude Code off" });
    await fireEvent.click(off);

    await waitFor(() => expect(pluginsSetAutoUpdate).toHaveBeenCalledWith("claude", "wakatime-sync", false));
    await waitFor(() => expect(on.getAttribute("aria-pressed")).toBe("true"));
    expect(off.getAttribute("aria-pressed")).toBe("false");
  });
});
