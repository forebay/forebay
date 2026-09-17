// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import type { PluginConfigSchema } from "@forebay/shared";
import PluginControls from "./PluginControls.svelte";

// A plugin's own page shows everything it declared; a screen that also renders the
// contributed section asks for the remainder so no control appears twice.
describe("PluginControls and contributed sections", () => {
  const SCHEMA: PluginConfigSchema = {
    plugin: "p",
    defaults: { claimed: true, spare: true },
    current: {},
    fields: [{ key: "claimed", type: "boolean", label: "Claimed" }, { key: "spare", type: "boolean", label: "Spare" }],
    actions: [{ id: "go", label: "Go" }],
    layout: {
      sections: [{ id: "s", label: "S", plugin: "p", fields: [{ key: "claimed", type: "boolean", label: "Claimed" }], actions: [{ id: "go", label: "Go" }] }],
      fields: [{ key: "spare", type: "boolean", label: "Spare" }],
      actions: [],
    },
  };

  it("renders the whole declaration by default", async () => {
    render(PluginControls, { homeId: "claude", schema: SCHEMA });
    expect(await screen.findByRole("switch", { name: "p Claimed" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "p Spare" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("renders only one section when asked for it by id", async () => {
    render(PluginControls, { homeId: "claude", schema: SCHEMA, sectionId: "s" });
    expect(await screen.findByRole("switch", { name: "p Claimed" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "p Spare" })).toBeNull();
  });

  it("names the home a spanning write failed in, since the others may have succeeded", async () => {
    stubForebay({
      configWrite: async (home: string) => (home === "opencode" ? { ok: false, error: "read-only home" } : { ok: true, data: undefined }),
    });
    const schema: PluginConfigSchema = { plugin: "p", defaults: { on: true }, current: {}, fields: [{ key: "on", type: "boolean" }] };
    render(PluginControls, { homeId: "claude", schema, writeHomes: ["claude", "opencode"] });

    await fireEvent.click(await screen.findByRole("switch", { name: "p on" }));
    expect(await screen.findByText("opencode: read-only home")).toBeInTheDocument();
  });

  it("drops what a section claimed when the screen already renders that section", async () => {
    render(PluginControls, { homeId: "claude", schema: SCHEMA, hideContributed: true });
    expect(await screen.findByRole("switch", { name: "p Spare" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "p Claimed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
  });
});

describe("PluginControls", () => {
  it("renders a declared select and writes the coerced value", async () => {
    const writes: unknown[][] = [];
    stubForebay({ configWrite: async (...args: unknown[]) => { writes.push(args); return { ok: true, data: undefined }; } });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: { mode: "fast" }, current: {},
      fields: [{ key: "mode", type: "select", label: "Mode", group: "Routing", options: [{ value: "fast", label: "Fast" }, { value: "cheap", label: "Cheap" }] }],
    };
    render(PluginControls, { homeId: "claude", schema });

    const select = (await screen.findByLabelText("p Mode")) as HTMLSelectElement;
    expect(select.value).toBe("fast");
    await fireEvent.change(select, { target: { value: "cheap" } });
    await waitFor(() => expect(writes).toContainEqual(["claude", "p", "mode", "cheap"]));
  });

  it("renders a number field honoring bounds and writes a number", async () => {
    const writes: unknown[][] = [];
    stubForebay({ configWrite: async (...args: unknown[]) => { writes.push(args); return { ok: true, data: undefined }; } });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: { level: 3 }, current: {},
      fields: [{ key: "level", type: "number", min: 1, max: 9, step: 1 }],
    };
    render(PluginControls, { homeId: "claude", schema });
    const input = (await screen.findByLabelText("p level")) as HTMLInputElement;
    expect(input.min).toBe("1");
    expect(input.max).toBe("9");
    await fireEvent.change(input, { target: { value: "7" } });
    await waitFor(() => expect(writes).toContainEqual(["claude", "p", "level", 7]));
  });

  it("falls back to type-inference when no fields are declared", async () => {
    const writes: unknown[][] = [];
    stubForebay({ configWrite: async (...args: unknown[]) => { writes.push(args); return { ok: true, data: undefined }; } });
    const schema: PluginConfigSchema = { plugin: "p", defaults: { enabled: true }, current: {} };
    render(PluginControls, { homeId: "claude", schema });
    const toggle = await screen.findByRole("switch", { name: "p enabled" });
    await fireEvent.click(toggle);
    await waitFor(() => expect(writes).toContainEqual(["claude", "p", "enabled", false]));
  });

  it("runs an action after confirming and shows its output", async () => {
    const action = vi.fn(async () => ({ ok: true, data: { stdout: "pinged", stderr: "" } }) as const);
    stubForebay({ configAction: action });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: {}, current: {},
      actions: [{ id: "ping", label: "Ping", confirm: "Send a ping?" }],
    };
    render(PluginControls, { homeId: "claude", schema });

    await fireEvent.click(await screen.findByRole("button", { name: "Ping" }));
    expect(action).not.toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("claude", "p", "ping", undefined));
    await waitFor(() => expect(screen.getByText("pinged")).toBeInTheDocument());
  });

  // An action that declares args asked for them before it ran, so the button that used to fail
  // immediately now collects first.
  it("asks for a declared arg before running, and runs with what was typed", async () => {
    const action = vi.fn(async () => ({ ok: true, data: { stdout: "created", stderr: "" } }) as const);
    stubForebay({ configAction: action });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: {}, current: {},
      actions: [{ id: "profileCreate", label: "Create", args: [{ key: "name", type: "string", label: "Profile name" }] }],
    };
    render(PluginControls, { homeId: "claude", schema });

    await fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    expect(action).not.toHaveBeenCalled();

    const field = await screen.findByLabelText("Profile name");
    await fireEvent.change(field, { target: { value: "work" } });
    await fireEvent.click(await screen.findByRole("button", { name: "Create" }));

    await waitFor(() => expect(action).toHaveBeenCalledWith("claude", "p", "profileCreate", { name: "work" }));
  });

  it("abandons a collection on cancel, without running", async () => {
    const action = vi.fn(async () => ({ ok: true, data: { stdout: "", stderr: "" } }) as const);
    stubForebay({ configAction: action });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: {}, current: {},
      actions: [{ id: "profileCreate", label: "Create", args: [{ key: "name", type: "string", label: "Profile name" }] }],
    };
    render(PluginControls, { homeId: "claude", schema });

    await fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Profile name")).toBeNull();
  });

  it("resolves a dot-path field's initial value from nested current/defaults", async () => {
    const writes: unknown[][] = [];
    stubForebay({ configWrite: async (...args: unknown[]) => { writes.push(args); return { ok: true, data: undefined }; } });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: { categories: { accounts: true } }, current: { categories: { accounts: false } },
      fields: [{ key: "categories.accounts", type: "boolean", label: "Accounts" }],
    };
    render(PluginControls, { homeId: "claude", schema });
    const toggle = await screen.findByRole("switch", { name: "p Accounts" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await fireEvent.click(toggle);
    await waitFor(() => expect(writes).toContainEqual(["claude", "p", "categories.accounts", true]));
  });

  it("adds a list item and writes the grown array", async () => {
    const writes: unknown[][] = [];
    stubForebay({ configWrite: async (...args: unknown[]) => { writes.push(args); return { ok: true, data: undefined }; } });
    const schema: PluginConfigSchema = {
      plugin: "p", defaults: { hooks: ["https://a"] }, current: {},
      fields: [{ key: "hooks", type: "list", itemType: "string", label: "Hooks" }],
    };
    render(PluginControls, { homeId: "claude", schema });
    await fireEvent.click(await screen.findByRole("button", { name: "+ Add" }));
    await waitFor(() => expect(writes).toContainEqual(["claude", "p", "hooks", ["https://a", ""]]));
  });
});
