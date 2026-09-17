// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { router, navigate } from "../router.js";
import Sidebar from "./Sidebar.svelte";
import { serverStatus } from "../serverStatus.js";

describe("Sidebar", () => {
  it("always shows the Routing nav item", () => {
    stubForebay();
    const { getByText } = render(Sidebar);
    expect(getByText("Routing")).toBeTruthy();
  });
});

describe("contributed screens", () => {
  it("renders a nav item per contributed screen, with its declared label and glyph", async () => {
    stubForebay({ screensList: async () => ({ ok: true, data: [{ plugin: "config-ledger", id: "main", label: "Ledger", glyph: "@", homes: ["claude"], layout: { kind: "text" } }] }) });
    render(Sidebar);

    const button = await screen.findByRole("button", { name: /Ledger/ });
    expect(button.textContent).toContain("@");
  });

  it("navigates to that plugin's own screen when the item is pressed", async () => {
    stubForebay({ screensList: async () => ({ ok: true, data: [{ plugin: "config-ledger", id: "main", label: "Ledger", homes: ["claude"], layout: { kind: "text" } }] }) });
    render(Sidebar);

    await fireEvent.click(await screen.findByRole("button", { name: /Ledger/ }));
    expect(get(router).screen).toBe("plugin:config-ledger:main");
    navigate("overview");
  });

  it("shows no plugin section at all when nothing contributes a screen", async () => {
    stubForebay({ screensList: async () => ({ ok: true, data: [] }) });
    render(Sidebar);

    await waitFor(() => expect(screen.getByText("Network")).toBeInTheDocument());
    expect(screen.queryByText("Plugins", { selector: "p" })).toBeNull();
  });
});

describe("screen painting", () => {
  it("paints cached screens first, then replaces them when the refresh lands", async () => {
    const calls: (boolean | undefined)[] = [];
    stubForebay({
      screensList: async (opts?: { wait?: boolean }) => {
        calls.push(opts?.wait);
        return opts?.wait
          ? { ok: true as const, data: [{ plugin: "ledger", id: "main", label: "Fresh", homes: ["claude"], layout: { kind: "text" } }] }
          : { ok: true as const, data: [{ plugin: "ledger", id: "main", label: "Cached", homes: ["claude"], layout: { kind: "text" } }] };
      },
    });
    render(Sidebar);

    expect(await screen.findByRole("button", { name: /Cached/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Fresh/ })).toBeInTheDocument();
    expect(calls).toEqual([undefined, true]);
    navigate("overview");
  });

  it("survives a cached answer with no data array (a stale pre-upgrade cache) and still refreshes", async () => {
    stubForebay({
      screensList: async (opts?: { wait?: boolean }) => (opts?.wait
        ? { ok: true as const, data: [{ plugin: "ledger", id: "main", label: "Ledger", homes: ["claude"], layout: { kind: "text" } }] }
        : { ok: true as const, data: undefined as never }),
    });
    render(Sidebar);

    expect(await screen.findByRole("button", { name: /Ledger/ })).toBeInTheDocument();
  });

  it("still shows the refreshed screens when the cache was cold", async () => {
    stubForebay({
      screensList: async (opts?: { wait?: boolean }) => (opts?.wait
        ? { ok: true as const, data: [{ plugin: "ledger", id: "main", label: "Ledger", homes: ["claude"], layout: { kind: "text" } }] }
        : { ok: true as const, data: [] }),
    });
    render(Sidebar);

    expect(await screen.findByRole("button", { name: /Ledger/ })).toBeInTheDocument();
  });

  // The reported bug: a stopped proxy read as online because unknown defaulted to running.
  it("shows the Local API as unknown until a status arrives, never as running", () => {
    serverStatus.set(null);
    const { container } = render(Sidebar);
    const dot = container.querySelector(".foot .dot");
    expect(dot?.classList.contains("unknown")).toBe(true);
    expect(dot?.classList.contains("off")).toBe(false);
    expect(container.querySelector(".foot")?.getAttribute("title")).toContain("unknown");
  });

  it("shows the Local API as stopped once a stopped status arrives", () => {
    serverStatus.set({ running: false, port: 34567 });
    const { container } = render(Sidebar);
    const dot = container.querySelector(".foot .dot");
    expect(dot?.classList.contains("off")).toBe(true);
    expect(dot?.classList.contains("unknown")).toBe(false);
    expect(container.querySelector(".foot")?.getAttribute("title")).toContain("stopped");
  });

  it("shows the Local API as running only when it really is", () => {
    serverStatus.set({ running: true, port: 34567 });
    const { container } = render(Sidebar);
    const dot = container.querySelector(".foot .dot");
    expect(dot?.classList.contains("off")).toBe(false);
    expect(dot?.classList.contains("unknown")).toBe(false);
    expect(container.querySelector(".foot")?.getAttribute("title")).toContain("running");
  });
});
