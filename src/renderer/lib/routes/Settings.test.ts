// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import type { HomePlugins, PluginConfigSchema } from "@forebay/shared";

vi.mock("../theme.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../theme.js")>();
  return { ...actual, applyThemeSetting: vi.fn() };
});

import { applyThemeSetting } from "../theme.js";
import Settings from "./Settings.svelte";

function forebayHome(): HomePlugins {
  return { home: { id: "forebay", label: "Forebay", dir: "/store", present: true, managesPlugins: true }, rows: [] };
}

// A plugin declaring one contributed section plus a setting it left to its own group. The
// layout is what the sidecar resolves and ships; the renderer only places it.
const CONTRIBUTED_SCHEMA: PluginConfigSchema = {
  plugin: "a-plugin",
  defaults: { on: true, spare: true },
  current: {},
  fields: [{ key: "on", type: "boolean", label: "On" }, { key: "spare", type: "boolean", label: "Spare" }],
  actions: [{ id: "doIt", label: "Do it" }],
  layout: {
    sections: [{
      id: "feature",
      label: "Feature",
      plugin: "a-plugin",
      fields: [{ key: "on", type: "boolean", label: "On" }],
      actions: [{ id: "doIt", label: "Do it" }],
    }],
    fields: [{ key: "spare", type: "boolean", label: "Spare" }],
    actions: [],
  },
};

describe("Settings screen", () => {
  it("loads and saves the four Forebay settings, asserting exact setConfig triples", async () => {
    const setConfigCalls: unknown[][] = [];
    stubForebay({
      getConfig: async (name: string, key: string) => {
        if (name === "forebay" && key === "theme") return { ok: true, data: "dark" };
        if (name === "forebay" && key === "showDeprecated") return { ok: true, data: false };
        if (name === "forebay" && key === "autoUpdateDefault") return { ok: true, data: false };
        if (name === "forebay" && key === "proxyAutostart") return { ok: true, data: true };
        return { ok: true, data: undefined };
      },
      setConfig: async (...args: unknown[]) => {
        setConfigCalls.push(args);
        return { ok: true, data: undefined };
      },
      pluginsList: async () => ({ ok: true, data: [forebayHome()] }),
    });

    render(Settings);

    const themeSelect = (await screen.findByLabelText("Theme")) as HTMLSelectElement;
    const showDeprecatedSwitch = screen.getByRole("switch", { name: "Show deprecated plugins" });
    const autoUpdateSwitch = screen.getByRole("switch", { name: "Auto-update new installs" });
    const proxyAutostartSwitch = screen.getByRole("switch", { name: "Start the local API on launch" });

    await waitFor(() => {
      expect(themeSelect.value).toBe("dark");
      expect(showDeprecatedSwitch.getAttribute("aria-checked")).toBe("false");
      expect(autoUpdateSwitch.getAttribute("aria-checked")).toBe("false");
      expect(proxyAutostartSwitch.getAttribute("aria-checked")).toBe("true");
    });

    await fireEvent.change(themeSelect, { target: { value: "light" } });
    await fireEvent.click(showDeprecatedSwitch);
    await fireEvent.click(autoUpdateSwitch);
    await fireEvent.click(proxyAutostartSwitch);

    await waitFor(() => expect(setConfigCalls).toContainEqual(["forebay", "theme", "light"]));
    expect(setConfigCalls).toContainEqual(["forebay", "showDeprecated", true]);
    expect(setConfigCalls).toContainEqual(["forebay", "autoUpdateDefault", true]);
    expect(setConfigCalls).toContainEqual(["forebay", "proxyAutostart", false]);
  });

  it("renders the shared settings from the schema, not from a hardcoded key list", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [forebayHome()] }),
      globalSettingsRead: async () => ({
        ok: true,
        data: {
          defaults: { activityMinImpact: "info" },
          current: {},
          fields: [{ key: "activityMinImpact", type: "select", label: "Record activity from", options: [{ value: "info", label: "info" }] }],
        },
      }),
    });

    render(Settings);

    expect(await screen.findByLabelText("Record activity from")).toBeInTheDocument();
  });

  it("applies the theme via applyThemeSetting on load and on change", async () => {
    stubForebay({ pluginsList: async () => ({ ok: true, data: [forebayHome()] }) });
    render(Settings);

    const themeSelect = (await screen.findByLabelText("Theme")) as HTMLSelectElement;
    await waitFor(() => expect(applyThemeSetting).toHaveBeenCalledWith("system"));

    await fireEvent.change(themeSelect, { target: { value: "dark" } });
    await waitFor(() => expect(applyThemeSetting).toHaveBeenCalledWith("dark"));
  });

  it("renders a per-app group's boolean field and writes via configWrite on toggle", async () => {
    const writeCalls: unknown[][] = [];
    const schema: PluginConfigSchema = { plugin: "wakatime-sync", defaults: { enabled: true }, current: {} };
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [forebayHome()] }),
      configSchemas: async (home: string) => ({ ok: true, data: home === "forebay" ? [schema] : [] }),
      configWrite: async (...args: unknown[]) => {
        writeCalls.push(args);
        return { ok: true, data: undefined };
      },
    });

    render(Settings);

    const fieldSwitch = await screen.findByRole("switch", { name: "wakatime-sync enabled" });
    expect(fieldSwitch.getAttribute("aria-checked")).toBe("true");

    await fireEvent.click(fieldSwitch);
    await waitFor(() => expect(writeCalls).toContainEqual(["forebay", "wakatime-sync", "enabled", false]));
  });

  it("shows an inline error when pluginsList fails, without blocking the Forebay settings", async () => {
    stubForebay({ pluginsList: async () => ({ ok: false, error: "list boom" }) });
    render(Settings);
    await waitFor(() => expect(screen.getByText(/list boom/i)).toBeTruthy());
    expect(await screen.findByLabelText("Theme")).toBeInTheDocument();
  });

  // Nothing here names a plugin: the section, its controls and its action all come from the
  // declaration, which is the whole point of the contribution surface.
  it("renders a contributed section with its attribution, controls and action", async () => {
    const writeCalls: unknown[][] = [];
    const runAction = vi.fn(async () => ({ ok: true, data: { stdout: "done", stderr: "" } }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [forebayHome()] }),
      settingsSections: async () => ({
        ok: true,
        data: [{ plugin: "a-plugin", id: "feature", label: "Feature", description: "What it does.", homes: ["forebay"] }],
      }),
      configSchemas: async () => ({ ok: true, data: [CONTRIBUTED_SCHEMA] }),
      configWrite: async (...args: unknown[]) => { writeCalls.push(args); return { ok: true, data: undefined }; },
      configAction: runAction,
    });

    render(Settings);

    expect(await screen.findByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("Added by a-plugin")).toBeInTheDocument();
    expect(screen.getByText("What it does.")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("switch", { name: "a-plugin On" }));
    await waitFor(() => expect(writeCalls).toContainEqual(["forebay", "a-plugin", "on", false]));

    await fireEvent.click(screen.getByRole("button", { name: "Do it" }));
    await waitFor(() => expect(runAction).toHaveBeenCalledWith("forebay", "a-plugin", "doIt", undefined));
  });

  it("keeps a control a section claimed out of the plugin's own per-app group", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [forebayHome()] }),
      settingsSections: async () => ({
        ok: true,
        data: [{ plugin: "a-plugin", id: "feature", label: "Feature", homes: ["forebay"] }],
      }),
      configSchemas: async () => ({ ok: true, data: [CONTRIBUTED_SCHEMA] }),
    });

    render(Settings);

    await waitFor(() => expect(screen.getAllByRole("switch", { name: "a-plugin On" })).toHaveLength(1));
    expect(screen.getByRole("switch", { name: "a-plugin Spare" })).toBeInTheDocument();
  });

  it("writes to every home a section declared as spanning them", async () => {
    const writeCalls: unknown[][] = [];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [forebayHome()] }),
      settingsSections: async () => ({
        ok: true,
        data: [{ plugin: "a-plugin", id: "feature", label: "Feature", scope: "allHomes", homes: ["claude", "opencode"] }],
      }),
      configSchemas: async () => ({ ok: true, data: [CONTRIBUTED_SCHEMA] }),
      configWrite: async (...args: unknown[]) => { writeCalls.push(args); return { ok: true, data: undefined }; },
    });

    render(Settings);

    await fireEvent.click(await screen.findByRole("switch", { name: "a-plugin On" }));
    await waitFor(() => expect(writeCalls).toContainEqual(["claude", "a-plugin", "on", false]));
    expect(writeCalls).toContainEqual(["opencode", "a-plugin", "on", false]);
  });
});

// Reading a plugin's settings runs its bundle, so a screen with several apps must not pay
// for every app on mount. The first app is open (the common single-app case needs no click);
// the rest load when opened.
describe("per-app settings loading", () => {
  function homes() {
    return [
      { home: { id: "forebay", label: "Forebay", dir: "/c", present: true, managesPlugins: false }, rows: [] },
      { home: { id: "claude", label: "Claude Code", dir: "/cc", present: true, managesPlugins: false }, rows: [] },
      { home: { id: "opencode", label: "OpenCode", dir: "/oc", present: true, managesPlugins: false }, rows: [] },
    ];
  }

  it("fetches only the first app's schemas on mount", async () => {
    const asked: string[] = [];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: homes() }),
      configSchemas: async (home: string) => { asked.push(home); return { ok: true, data: [] }; },
    });
    render(Settings);

    await waitFor(() => expect(asked).toEqual(["forebay"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual(["forebay"]);
  });

  it("fetches an app's schemas when its section is opened", async () => {
    const asked: string[] = [];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: homes() }),
      configSchemas: async (home: string) => { asked.push(home); return { ok: true, data: [] }; },
    });
    render(Settings);
    await waitFor(() => expect(asked).toEqual(["forebay"]));

    await fireEvent.click(screen.getByRole("button", { name: "Toggle Claude Code section" }));
    await waitFor(() => expect(asked).toEqual(["forebay", "claude"]));
  });

  it("does not refetch a section that was already opened", async () => {
    const asked: string[] = [];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: homes() }),
      configSchemas: async (home: string) => { asked.push(home); return { ok: true, data: [] }; },
    });
    render(Settings);
    await waitFor(() => expect(asked).toEqual(["forebay"]));

    const toggle = screen.getByRole("button", { name: "Toggle OpenCode section" });
    await fireEvent.click(toggle);
    await waitFor(() => expect(asked).toEqual(["forebay", "opencode"]));
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual(["forebay", "opencode"]);
  });
});
