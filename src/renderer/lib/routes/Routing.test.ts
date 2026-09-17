// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { toasts, toast } from "../toast.js";
import { consumeParams } from "../router.js";
import Routing from "./Routing.svelte";

const CATALOG = [
  { provider: "stub", model: "m1", name: "Stub M1" },
  { provider: "stub", model: "m2", name: "Stub M2" },
];

const ONE_APP = [{ app: "claude" as const, label: "Claude Code" }];
const TWO_APPS = [
  { app: "claude" as const, label: "Claude Code" },
  { app: "opencode" as const, label: "OpenCode" },
];

describe("Routing screen", () => {
  beforeEach(() => {
    get(toasts).slice().forEach((t) => toast.dismiss(t.id));
  });

  it("renders a tier with its current chain", async () => {
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({
        ok: true,
        data: {
          tiers: ["opus"],
          map: { default: [], opus: [{ provider: "stub", model: "m1", name: "Stub M1" }] },
          catalog: CATALOG,
        },
      }),
    });

    const { getByText } = render(Routing);

    await waitFor(() => expect(getByText("opus")).toBeTruthy());
    expect(getByText("Stub M1")).toBeTruthy();
    expect(getByText("stub")).toBeTruthy();
  });

  it("calls routingSetChain with the current app when adding a model to an empty tier", async () => {
    const routingSetChain = vi.fn(async () => ({ ok: true, data: { warnings: [] } }) as const);
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({
        ok: true,
        data: {
          tiers: ["opus"],
          map: { default: [], opus: [] },
          catalog: CATALOG,
        },
      }),
      routingSetChain,
    });

    const { getByLabelText, getByText } = render(Routing);

    await waitFor(() => expect(getByText("opus")).toBeTruthy());

    const select = getByLabelText("Add model to opus") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "stub|m1" } });
    const addRow = select.closest(".add-row") as HTMLElement;
    await fireEvent.click(within(addRow).getByText("Add"));

    await waitFor(() =>
      expect(routingSetChain).toHaveBeenCalledWith("claude", "opus", [{ provider: "stub", model: "m1" }]),
    );
  });

  it("shows an inline error when routingGet fails", async () => {
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({ ok: false, error: "boom" }),
    });
    const { getByText } = render(Routing);
    await waitFor(() => expect(getByText(/boom/i)).toBeTruthy());
  });

  it("surfaces warnings returned from routingSetChain", async () => {
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({
        ok: true,
        data: { tiers: ["opus"], map: { default: [], opus: [] }, catalog: CATALOG },
      }),
      routingSetChain: async () => ({ ok: true, data: { warnings: ["provider stub is disabled"] } }),
    });

    const { getByLabelText, getByText } = render(Routing);
    await waitFor(() => expect(getByText("opus")).toBeTruthy());

    const select = getByLabelText("Add model to opus") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "stub|m1" } });
    const addRow = select.closest(".add-row") as HTMLElement;
    await fireEvent.click(within(addRow).getByText("Add"));

    await waitFor(() => expect(getByText(/provider stub is disabled/i)).toBeTruthy());
  });

  it("renders a switcher with all app labels when more than one app is available", async () => {
    stubForebay({
      routingApps: async () => ({ ok: true, data: TWO_APPS }),
      routingGet: async () => ({
        ok: true,
        data: { tiers: [], map: { default: [] }, catalog: CATALOG },
      }),
    });

    const { getByText } = render(Routing);

    await waitFor(() => {
      expect(getByText("Claude Code")).toBeTruthy();
      expect(getByText("OpenCode")).toBeTruthy();
    });
  });

  it("switches app and reloads routing when a switcher tab is clicked", async () => {
    const routingGet = vi.fn(async (app: string) => ({
      ok: true,
      data: { tiers: [`${app}-tier`], map: { default: [] }, catalog: CATALOG },
    }));
    stubForebay({
      routingApps: async () => ({ ok: true, data: TWO_APPS }),
      routingGet: routingGet as unknown as Parameters<typeof stubForebay>[0]["routingGet"],
    });

    const { getByText } = render(Routing);

    await waitFor(() => expect(getByText("claude-tier")).toBeTruthy());

    await fireEvent.click(getByText("OpenCode"));

    await waitFor(() => expect(getByText("opencode-tier")).toBeTruthy());
    expect(routingGet).toHaveBeenCalledWith("opencode");
  });

  it("confirms before removing a routing step from a chain", async () => {
    const routingSetChain = vi.fn(async () => ({ ok: true, data: { warnings: [] } }) as const);
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({
        ok: true,
        data: {
          tiers: ["opus"],
          map: { default: [], opus: [{ provider: "stub", model: "m1", name: "Stub M1" }] },
          catalog: CATALOG,
        },
      }),
      routingSetChain,
    });

    const { getByText, getByRole } = render(Routing);
    await waitFor(() => expect(getByText("Stub M1")).toBeTruthy());

    await fireEvent.click(getByRole("button", { name: "Remove" }));
    expect(routingSetChain).not.toHaveBeenCalled();

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(routingSetChain).toHaveBeenCalledWith("claude", "opus", []));
  });

  it("toasts an error when removing a routing step fails, without a success toast", async () => {
    const routingSetChain = vi.fn(async () => ({ ok: false, error: "chain boom" }) as const);
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({
        ok: true,
        data: {
          tiers: ["opus"],
          map: { default: [], opus: [{ provider: "stub", model: "m1", name: "Stub M1" }] },
          catalog: CATALOG,
        },
      }),
      routingSetChain,
    });

    const { getByText, getByRole } = render(Routing);
    await waitFor(() => expect(getByText("Stub M1")).toBeTruthy());

    await fireEvent.click(getByRole("button", { name: "Remove" }));
    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(get(toasts).some((t) => t.kind === "error" && t.message === "chain boom")).toBe(true));
    expect(get(toasts).some((t) => t.kind === "success")).toBe(false);
  });

  it("shows an empty state when no app has a proxy plugin installed", async () => {
    stubForebay({ routingApps: async () => ({ ok: true, data: [] }) });

    const { getByText } = render(Routing);

    await waitFor(() => expect(getByText(/install a proxy in plugins to configure routing/i)).toBeTruthy());
    expect(getByText("Browse proxies")).toBeTruthy();
  });

  it("navigates to Plugins filtered to proxies from the empty-state CTA", async () => {
    stubForebay({ routingApps: async () => ({ ok: true, data: [] }) });

    const { getByText } = render(Routing);

    await waitFor(() => expect(getByText("Browse proxies")).toBeTruthy());
    await fireEvent.click(getByText("Browse proxies"));

    const params = consumeParams();
    expect(params).toEqual({ kind: "proxy" });
  });

  it("reorders chain entries with the up/down controls", async () => {
    const routingSetChain = vi.fn(async () => ({ ok: true, data: { warnings: [] } }) as const);
    stubForebay({
      routingApps: async () => ({ ok: true, data: ONE_APP }),
      routingGet: async () => ({
        ok: true,
        data: {
          tiers: ["opus"],
          map: {
            default: [],
            opus: [
              { provider: "a", model: "m1" },
              { provider: "b", model: "m2" },
            ],
          },
          catalog: CATALOG,
        },
      }),
      routingSetChain,
    });

    const { getByLabelText } = render(Routing);
    await waitFor(() => expect(getByLabelText(/Move m1 up/)).toBeTruthy());

    expect(getByLabelText(/Move m1 up/)).toBeDisabled();
    expect(getByLabelText(/Move m2 down/)).toBeDisabled();
    expect(getByLabelText(/Move m1 down/)).not.toBeDisabled();
    expect(getByLabelText(/Move m2 up/)).not.toBeDisabled();

    await fireEvent.click(getByLabelText(/Move m1 down/));

    await waitFor(() =>
      expect(routingSetChain).toHaveBeenCalledWith("claude", "opus", [
        { provider: "b", model: "m2" },
        { provider: "a", model: "m1" },
      ]),
    );
  });
});
