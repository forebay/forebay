// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { toasts } from "../toast.js";
import AppStorageSection from "./AppStorageSection.svelte";

const NAMES = { repos: "repos", plugin: "plugin", cache: "cache", config: "config" };

function storage(names = NAMES) {
  return {
    ok: true as const,
    data: {
      app: "claude",
      home: "/home/jane/.claude",
      names,
      defaults: NAMES,
      resolved: { repos: "/home/jane/.claude/repos", plugin: "/home/jane/.claude/plugin", cache: "/home/jane/.claude/cache", config: "/home/jane/.claude/config" },
    },
  };
}

describe("AppStorageSection", () => {
  it("shows the home and its four subdirectory names", async () => {
    stubForebay({ appStorageGet: async () => storage() });
    render(AppStorageSection, { props: { app: "claude" } });

    expect(await screen.findByText("/home/jane/.claude")).toBeInTheDocument();
    expect(screen.getByText("Repos")).toBeInTheDocument();
    expect(screen.getByText("Cache")).toBeInTheDocument();
  });

  it("only offers fields once Change is pressed", async () => {
    stubForebay({ appStorageGet: async () => storage() });
    render(AppStorageSection, { props: { app: "claude" } });
    await screen.findByText("/home/jane/.claude");

    expect(screen.queryByLabelText("Repos directory name")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByLabelText("Repos directory name")).toBeInTheDocument();
  });

  it("saves the edited names and says what moved", async () => {
    const appStorageSet = vi.fn(async () => ({
      ok: true as const,
      data: { names: { ...NAMES, repos: "clones" }, moves: [{ kind: "repos" as const, from: "repos", to: "clones", status: "moved" as const }] },
    }));
    stubForebay({ appStorageGet: async () => storage(), appStorageSet });
    render(AppStorageSection, { props: { app: "claude" } });
    await screen.findByText("/home/jane/.claude");
    await fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await fireEvent.input(screen.getByLabelText("Repos directory name"), { target: { value: "clones" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(appStorageSet).toHaveBeenCalledWith("claude", { ...NAMES, repos: "clones" }));
    await waitFor(() => expect(get(toasts).some((t) => /moved repos to clones/.test(t.message))).toBe(true));
  });

  // Nothing to save is not a state worth offering a button for, and pressing it would
  // rename four directories onto themselves.
  it("keeps Save unavailable until a name actually changes", async () => {
    stubForebay({ appStorageGet: async () => storage() });
    render(AppStorageSection, { props: { app: "claude" } });
    await screen.findByText("/home/jane/.claude");
    await fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await fireEvent.input(screen.getByLabelText("Cache directory name"), { target: { value: "tmp" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
  });

  // The rules live in core, so whatever it refuses is shown as it came back rather than
  // being second-guessed here.
  it("surfaces the reason a save was refused", async () => {
    stubForebay({
      appStorageGet: async () => storage(),
      appStorageSet: async () => ({ ok: false as const, error: "repos: clones already exists in this home" }),
    });
    render(AppStorageSection, { props: { app: "claude" } });
    await screen.findByText("/home/jane/.claude");
    await fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await fireEvent.input(screen.getByLabelText("Repos directory name"), { target: { value: "clones" } });

    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/clones already exists/)).toBeInTheDocument();
  });

  it("drops the edits on cancel", async () => {
    stubForebay({ appStorageGet: async () => storage() });
    render(AppStorageSection, { props: { app: "claude" } });
    await screen.findByText("/home/jane/.claude");
    await fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await fireEvent.input(screen.getByLabelText("Repos directory name"), { target: { value: "clones" } });

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByLabelText("Repos directory name")).toBeNull());
    expect(screen.getByText("repos")).toBeInTheDocument();
  });
});
