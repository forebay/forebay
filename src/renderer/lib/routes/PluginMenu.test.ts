// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import PluginMenu from "./PluginMenu.svelte";
import { stubForebay } from "../testing.js";

const SCREEN = {
  plugin: "demo", id: "config", label: "Config", homes: ["claude"], refreshOn: ["config."],
  layout: { kind: "stack", children: [{ kind: "text", source: "line" }, { kind: "actions", ids: ["go"] }] },
};

describe("PluginMenu", () => {
  it("paints the plugin's screen from its own data", async () => {
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN] }),
      screenData: async () => ({ ok: true, data: { sources: { line: "from the plugin" } } }),
    });
    render(PluginMenu, { plugin: "demo", screenId: "config" });
    await waitFor(() => expect(screen.getByText("from the plugin")).toBeInTheDocument());
  });

  it("re-reads after an action that asks for a refresh", async () => {
    const screenData = vi.fn(async () => ({ ok: true, data: { sources: { line: "v1" } } }));
    const screenInvoke = vi.fn(async () => ({ ok: true, data: { ok: true, refresh: true } }));
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN] }),
      screenData,
      screenInvoke,
    });
    render(PluginMenu, { plugin: "demo", screenId: "config" });
    await waitFor(() => expect(screen.getByRole("button", { name: "go" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(screenData).toHaveBeenCalledTimes(2));
    // Guards the positional order (plugin, screenId, actionId, homeId, args): a swap among the
    // four adjacent strings would call the wrong plugin, screen, action, or home unnoticed.
    expect(screenInvoke).toHaveBeenCalledWith("demo", "config", "go", "claude", {});
  });

  it("shows the plugin's own error rather than a blank screen", async () => {
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN] }),
      screenData: async () => ({ ok: false, error: "not a git repository" }),
    });
    render(PluginMenu, { plugin: "demo", screenId: "config" });
    await waitFor(() => expect(screen.getByText(/not a git repository/)).toBeInTheDocument());
  });

  it("says so when the plugin is installed nowhere", async () => {
    stubForebay({ screensList: async () => ({ ok: true, data: [{ ...SCREEN, homes: [] }] }) });
    render(PluginMenu, { plugin: "demo", screenId: "config" });
    await waitFor(() => expect(screen.getByText(/not installed/)).toBeInTheDocument());
  });

  // A screensList failure must not read as "not installed": that message means the plugin
  // was resolved and genuinely has no homes, which is not what a read error tells you.
  it("surfaces a failure to read the screens instead of rendering an empty screen", async () => {
    stubForebay({ screensList: async () => ({ ok: false, error: "sidecar down" }) });
    render(PluginMenu, { plugin: "demo", screenId: "config" });
    await waitFor(() => expect(screen.getByText(/sidecar down/)).toBeInTheDocument());
    expect(screen.queryByText(/not installed/)).toBeNull();
  });

  it("switches home when the plugin contributes in more than one", async () => {
    const SCREEN_MULTI = { ...SCREEN, homes: ["claude", "opencode"] };
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN_MULTI] }),
      pluginsList: async () => ({
        ok: true,
        data: [
          { home: { id: "claude", label: "Claude", dir: "/c", present: true, managesPlugins: true }, rows: [] },
          { home: { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true }, rows: [] },
        ],
      }),
      screenData: async (_plugin: string, _screenId: string, homeId: string) => ({
        ok: true,
        data: { sources: { line: homeId === "claude" ? "from Claude" : "from OpenCode" } },
      }),
    });
    render(PluginMenu, { plugin: "demo", screenId: "config" });

    await waitFor(() => expect(screen.getByText("from Claude")).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "OpenCode" }));
    await waitFor(() => expect(screen.getByText("from OpenCode")).toBeInTheDocument());
  });

  it("does not paint a slower home's answer once the user has switched away from it", async () => {
    let resolveClaude: (value: { ok: true; data: { sources: Record<string, unknown> } }) => void = () => {};
    const claudePending = new Promise<{ ok: true; data: { sources: Record<string, unknown> } }>((resolve) => { resolveClaude = resolve; });
    const SCREEN_MULTI = { ...SCREEN, homes: ["claude", "opencode"] };
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN_MULTI] }),
      pluginsList: async () => ({
        ok: true,
        data: [
          { home: { id: "claude", label: "Claude", dir: "/c", present: true, managesPlugins: true }, rows: [] },
          { home: { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true }, rows: [] },
        ],
      }),
      screenData: async (_plugin: string, _screenId: string, homeId: string) =>
        homeId === "claude" ? claudePending : { ok: true, data: { sources: { line: "from OpenCode" } } },
    });
    render(PluginMenu, { plugin: "demo", screenId: "config" });

    await waitFor(() => expect(screen.getByRole("button", { name: "OpenCode" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "OpenCode" }));
    await waitFor(() => expect(screen.getByText("from OpenCode")).toBeInTheDocument());

    resolveClaude({ ok: true, data: { sources: { line: "from Claude" } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("from OpenCode")).toBeInTheDocument();
    expect(screen.queryByText("from Claude")).toBeNull();
  });
});

describe("refreshOn", () => {
  // The plugin declares topic PREFIXES; the interval callback drains the bus itself, so the
  // test captures that callback (rather than waiting out the real 5s) and invokes it directly.
  async function capturedFollow(): Promise<() => Promise<void>> {
    const spy = vi.spyOn(globalThis, "setInterval");
    render(PluginMenu, { plugin: "demo", screenId: "config" });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const follow = spy.mock.calls[0][0] as unknown as () => Promise<void>;
    spy.mockRestore();
    return follow;
  }

  it("re-reads when a drained event's topic matches a declared prefix", async () => {
    const screenData = vi.fn(async () => ({ ok: true, data: { sources: { line: "v1" } } }));
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN] }),
      screenData,
      busDrain: async () => ({ ok: true, data: [{ topic: "config.changed", source: "demo", ts: 0, payload: null }] }),
    });
    const follow = await capturedFollow();
    await waitFor(() => expect(screenData).toHaveBeenCalledTimes(1));

    await follow();
    await waitFor(() => expect(screenData).toHaveBeenCalledTimes(2));
  });

  it("ignores a drained event whose topic does not match a declared prefix", async () => {
    const screenData = vi.fn(async () => ({ ok: true, data: { sources: { line: "v1" } } }));
    stubForebay({
      screensList: async () => ({ ok: true, data: [SCREEN] }),
      screenData,
      busDrain: async () => ({ ok: true, data: [{ topic: "other.thing", source: "demo", ts: 0, payload: null }] }),
    });
    const follow = await capturedFollow();
    await waitFor(() => expect(screenData).toHaveBeenCalledTimes(1));

    await follow();
    expect(screenData).toHaveBeenCalledTimes(1);
  });
});
