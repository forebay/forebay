// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { toasts, toast } from "../toast.js";
import { router, consumeParams } from "../router.js";
import LocalApi from "./LocalApi.svelte";

describe("LocalApi screen", () => {
  beforeEach(() => {
    get(toasts).slice().forEach((t) => toast.dismiss(t.id));
  });

  it("shows a start affordance when stopped and calls proxyStart on click", async () => {
    const proxyStart = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxyStart,
    });

    const { getByText } = render(LocalApi);

    await waitFor(() => expect(getByText("Stopped")).toBeTruthy());
    expect(getByText("34567")).toBeTruthy();

    await fireEvent.click(getByText("Start local API"));
    await waitFor(() => expect(proxyStart).toHaveBeenCalled());
  });

  it("shows the running state and calls proxyStop on click", async () => {
    const proxyStop = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: true, port: 34567 } }),
      proxyStop,
    });

    const { getByText, getAllByText } = render(LocalApi);

    await waitFor(() => expect(getByText("Running")).toBeTruthy());
    expect(getAllByText("http://127.0.0.1:34567").length).toBeGreaterThan(0);

    await fireEvent.click(getByText("Stop"));
    await waitFor(() => expect(proxyStop).toHaveBeenCalled());
  });

  it("disables the control while a start call is in flight", async () => {
    let resolveStart: (() => void) | undefined;
    const proxyStart = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve({ ok: true, data: undefined });
        }),
    );
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxyStart: proxyStart as unknown as () => Promise<{ ok: true; data: undefined }>,
    });

    const { getByText } = render(LocalApi);
    await waitFor(() => expect(getByText("Stopped")).toBeTruthy());

    const button = getByText("Start local API") as HTMLButtonElement;
    await fireEvent.click(button);
    expect(button.disabled).toBe(true);

    resolveStart?.();
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("shows an inline error when proxyStatus fails", async () => {
    stubForebay({ proxyStatus: async () => ({ ok: false, error: "boom" }) });
    const { getByText } = render(LocalApi);
    await waitFor(() => expect(getByText(/boom/i)).toBeTruthy());
  });

  it("retries proxyStatus when the retry button is clicked", async () => {
    const proxyStatus = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "boom" })
      .mockResolvedValueOnce({ ok: true, data: { running: false, port: 34567 } });
    stubForebay({ proxyStatus });

    const { getByText, getByRole } = render(LocalApi);
    await waitFor(() => expect(getByText(/boom/i)).toBeTruthy());

    const retryButton = getByRole("button", { name: /retry/i });
    await fireEvent.click(retryButton);

    expect(proxyStatus).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(getByText("Stopped")).toBeTruthy());
  });

  it("shows the start error when proxyStart fails", async () => {
    const proxyStart = vi.fn(async () => ({ ok: false, error: "no proxy plugin installed" }) as const);
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxyStart,
    });

    const { getByText } = render(LocalApi);
    await waitFor(() => expect(getByText("Stopped")).toBeTruthy());

    await fireEvent.click(getByText("Start local API"));
    await waitFor(() => {
      expect(getByText(/no proxy plugin installed/i)).toBeTruthy();
      expect(getByText("Start local API")).toBeTruthy();
    });
  });

  it("toasts an error when saving the port fails", async () => {
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      setConfig: async () => ({ ok: false, error: "boom" }),
    });

    const { getByLabelText, getByText } = render(LocalApi);
    await waitFor(() => expect(getByText("Stopped")).toBeTruthy());

    const input = getByLabelText("Local API port") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "8080" } });
    await fireEvent.click(getByText("Save"));

    await waitFor(() => expect(get(toasts).some((t) => t.kind === "error" && t.message === "boom")).toBe(true));
  });

  it("toasts success when saving the port succeeds", async () => {
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      setConfig: async () => ({ ok: true, data: undefined }),
    });

    const { getByLabelText, getByText } = render(LocalApi);
    await waitFor(() => expect(getByText("Stopped")).toBeTruthy());

    const input = getByLabelText("Local API port") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "8080" } });
    await fireEvent.click(getByText("Save"));

    await waitFor(() => expect(get(toasts).some((t) => t.kind === "success" && t.message === "Local API port saved")).toBe(true));
  });

  it("shows a muted message when no proxies are installed", async () => {
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxiesList: async () => ({ ok: true, data: [] }),
    });

    const { getByText } = render(LocalApi);
    await waitFor(() => expect(getByText(/No proxies installed/)).toBeTruthy());
  });

  it("navigates to the Plugins proxy filter when Add proxy is clicked", async () => {
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxiesList: async () => ({ ok: true, data: [] }),
    });
    router.set({ screen: "localApi" });
    const { getByText } = render(LocalApi);
    await waitFor(() => expect(getByText("+ Add proxy")).toBeTruthy());
    await fireEvent.click(getByText("+ Add proxy"));
    expect(get(router).screen).toBe("plugins");
    expect(consumeParams()).toEqual({ kind: "proxy" });
  });

  it("renders each installed proxy with its own setup instructions and toggle", async () => {
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxiesList: async () => ({
        ok: true,
        data: [
          { name: "some-proxy", app: "some-app", appLabel: "Some App", enabled: true, setup: "Run `some-app configure --local-api`." },
          { name: "other-proxy", app: "other-app", appLabel: "Other App", enabled: false },
        ],
      }),
    });

    const { getByText, getByRole } = render(LocalApi);
    await waitFor(() => expect(getByText("Some App")).toBeTruthy());

    expect(getByText("Run `some-app configure --local-api`.")).toBeTruthy();
    expect(getByText("Other App")).toBeTruthy();
    expect(getByText("Point this app at the local API base URL below.")).toBeTruthy();

    const someToggle = getByRole("switch", { name: "Some App enabled" });
    const otherToggle = getByRole("switch", { name: "Other App enabled" });
    expect(someToggle.getAttribute("aria-checked")).toBe("true");
    expect(otherToggle.getAttribute("aria-checked")).toBe("false");
  });

  it("calls proxiesSetEnabled when a proxy toggle is flipped", async () => {
    const proxiesSetEnabled = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxiesList: async () => ({
        ok: true,
        data: [{ name: "some-proxy", app: "some-app", appLabel: "Some App", enabled: false }],
      }),
      proxiesSetEnabled,
    });

    const { getByRole } = render(LocalApi);
    await waitFor(() => expect(getByRole("switch", { name: "Some App enabled" })).toBeTruthy());

    await fireEvent.click(getByRole("switch", { name: "Some App enabled" }));
    await waitFor(() => expect(proxiesSetEnabled).toHaveBeenCalledWith("some-proxy", true));
  });

  it("toasts an error when toggling a proxy fails", async () => {
    stubForebay({
      proxyStatus: async () => ({ ok: true, data: { running: false, port: 34567 } }),
      proxiesList: async () => ({
        ok: true,
        data: [{ name: "some-proxy", app: "some-app", appLabel: "Some App", enabled: false }],
      }),
      proxiesSetEnabled: async () => ({ ok: false, error: "boom" }),
    });

    const { getByRole } = render(LocalApi);
    await waitFor(() => expect(getByRole("switch", { name: "Some App enabled" })).toBeTruthy());

    await fireEvent.click(getByRole("switch", { name: "Some App enabled" }));
    await waitFor(() => expect(get(toasts).some((t) => t.kind === "error" && t.message === "boom")).toBe(true));
  });
});
