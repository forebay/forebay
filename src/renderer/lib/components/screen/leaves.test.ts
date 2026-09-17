// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import ScreenRenderer from "./ScreenRenderer.svelte";
import { stubForebay } from "../../testing.js";

function ctx(sources: Record<string, unknown>, invoke = vi.fn(async () => {})) {
  return { plugin: "p", screenId: "s", homeId: "claude", sources, invoke, busy: false };
}

beforeEach(() => {
  stubForebay();
});

describe("data leaves", () => {
  it("renders a stat per summary entry", () => {
    render(ScreenRenderer, { node: { kind: "stats", source: "summary" }, ctx: ctx({ summary: [{ id: "a", label: "Pending", value: 3 }] }) });
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("groups table rows by the declared key", () => {
    const node = { kind: "table", source: "rows", groupBy: "file", columns: [{ key: "key" }] };
    render(ScreenRenderer, { node, ctx: ctx({ rows: [{ id: "1", file: "settings.json", key: "theme" }, { id: "2", file: "settings.json", key: "font" }] }) });
    expect(screen.getByText("settings.json")).toBeInTheDocument();
    expect(screen.getByText("theme")).toBeInTheDocument();
  });

  it("shows the declared empty text for an empty collection", () => {
    render(ScreenRenderer, { node: { kind: "table", source: "rows", empty: "Nothing pending.", columns: [] }, ctx: ctx({ rows: [] }) });
    expect(screen.getByText("Nothing pending.")).toBeInTheDocument();
  });

  it("invokes a row action with that row's id", async () => {
    const invoke = vi.fn(async () => {});
    const node = { kind: "list", source: "rows", rowActions: ["restore"], item: { title: "subject" } };
    render(ScreenRenderer, { node, ctx: ctx({ rows: [{ id: "a1b2", subject: "manual snapshot" }] }, invoke) });
    await fireEvent.click(screen.getByRole("button", { name: "restore" }));
    expect(invoke).toHaveBeenCalledWith("restore", { id: "a1b2" });
  });

  it("invokes a chip's select action with the chip's id", async () => {
    const invoke = vi.fn(async () => {});
    render(ScreenRenderer, { node: { kind: "chips", source: "profiles", select: "profileSwitch" }, ctx: ctx({ profiles: [{ id: "work", label: "work", current: false }] }, invoke) });
    await fireEvent.click(screen.getByRole("button", { name: "work" }));
    expect(invoke).toHaveBeenCalledWith("profileSwitch", { id: "work" });
  });

  it("submits a form's typed values under their field keys", async () => {
    const invoke = vi.fn(async () => {});
    const node = { kind: "form", submit: "commit", fields: [{ key: "reason", type: "string", label: "Note" }] };
    render(ScreenRenderer, { node, ctx: ctx({}, invoke) });
    await fireEvent.input(screen.getByLabelText("Note"), { target: { value: "before upgrade" } });
    await fireEvent.click(screen.getByRole("button", { name: "commit" }));
    expect(invoke).toHaveBeenCalledWith("commit", { reason: "before upgrade" });
  });

  it("renders a banner only when its source has text", () => {
    const { unmount } = render(ScreenRenderer, { node: { kind: "banner", source: "notice" }, ctx: ctx({ notice: "" }) });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();
    render(ScreenRenderer, { node: { kind: "banner", source: "notice" }, ctx: ctx({ notice: "uncommitted changes" }) });
    expect(screen.getByRole("status")).toHaveTextContent("uncommitted changes");
  });
});

describe("data leaves backed by the plugin's own schema", () => {
  it("does not fall back to every declared or inferred field when none of them match the node's keys", async () => {
    stubForebay({
      configSchemas: async () => ({
        ok: true,
        data: [{
          plugin: "p",
          defaults: { token: "abc", spare: true },
          current: {},
          fields: [{ key: "token", type: "secret", label: "Token" }],
        }],
      }),
    });
    render(ScreenRenderer, { node: { kind: "fields", keys: ["nope"] }, ctx: ctx({}) });
    await waitFor(() => expect(screen.getByText("No controls.")).toBeInTheDocument());
    expect(screen.queryByLabelText("p Token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("p spare")).not.toBeInTheDocument();
  });

  it("routes a declared confirm through ConfirmDialog and invokes only after confirming", async () => {
    const invoke = vi.fn(async () => {});
    stubForebay({
      configSchemas: async () => ({
        ok: true,
        data: [{
          plugin: "p",
          defaults: {},
          current: {},
          actions: [{ id: "wipe", label: "Wipe", confirm: "Wipe everything?", danger: true }],
        }],
      }),
    });
    render(ScreenRenderer, { node: { kind: "actions", ids: ["wipe"] }, ctx: ctx({}, invoke) });

    await waitFor(() => expect(screen.getByRole("button", { name: "Wipe" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "Wipe" }));
    expect(screen.getByText("Wipe everything?")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(invoke).toHaveBeenCalledWith("wipe", {});
  });

  it("routes a list row action's declared confirm through ConfirmDialog before invoking", async () => {
    const invoke = vi.fn(async () => {});
    stubForebay({
      configSchemas: async () => ({
        ok: true,
        data: [{
          plugin: "p",
          defaults: {},
          current: {},
          actions: [{ id: "restore", label: "Restore", confirm: "Overwrite uncommitted changes?", danger: true }],
        }],
      }),
    });
    const node = { kind: "list", source: "rows", rowActions: ["restore"], item: { title: "subject" } };
    render(ScreenRenderer, { node, ctx: ctx({ rows: [{ id: "a1b2", subject: "manual snapshot" }] }, invoke) });

    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByText("Overwrite uncommitted changes?")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(invoke).toHaveBeenCalledWith("restore", { id: "a1b2" });
  });

  it("routes a table row action's declared confirm through ConfirmDialog before invoking", async () => {
    const invoke = vi.fn(async () => {});
    stubForebay({
      configSchemas: async () => ({
        ok: true,
        data: [{
          plugin: "p",
          defaults: {},
          current: {},
          actions: [{ id: "restore", label: "Restore", confirm: "Overwrite uncommitted changes?", danger: true }],
        }],
      }),
    });
    const node = { kind: "table", source: "rows", rowActions: ["restore"], columns: [{ key: "key" }] };
    render(ScreenRenderer, { node, ctx: ctx({ rows: [{ id: "a1b2", key: "theme" }] }, invoke) });

    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByText("Overwrite uncommitted changes?")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(invoke).toHaveBeenCalledWith("restore", { id: "a1b2" });
  });
});
