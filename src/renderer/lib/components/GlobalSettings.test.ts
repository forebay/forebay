// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

const setConfig = vi.fn(async () => ({ ok: true as const, data: undefined }));
const globalSettingsRead = vi.fn(async () => ({
  ok: true as const,
  data: {
    defaults: { logConsole: false, activityMinImpact: "info", activityMaxDays: 0 },
    current: { activityMinImpact: "notice" },
    fields: [
      { key: "logConsole", type: "boolean", label: "Mirror logs", group: "Logging" },
      { key: "activityMinImpact", type: "select", label: "Record activity from", group: "Activity", options: [{ value: "info", label: "info" }, { value: "notice", label: "notice" }] },
      { key: "activityMaxDays", type: "number", label: "Keep at most (days)", group: "Activity", min: 0, description: "0 keeps history unlimited." },
    ],
  },
}));
const activityStats = vi.fn(async () => ({
  ok: true as const,
  data: { homes: [], bytes: 2048, segments: 3, oldestTs: 1_700_000_000_000 },
}));

vi.mock("../ipc.js", () => ({
  forebay: {
    get globalSettingsRead() { return globalSettingsRead; },
    get activityStats() { return activityStats; },
    get setConfig() { return setConfig; },
  },
}));

beforeEach(() => {
  setConfig.mockClear();
  globalSettingsRead.mockClear();
  activityStats.mockClear();
});

describe("GlobalSettings", () => {
  it("renders a widget per field, using the on-disk value over the default", async () => {
    const GlobalSettings = (await import("./GlobalSettings.svelte")).default;
    const { getByLabelText, getByRole } = render(GlobalSettings);

    await waitFor(() => expect(getByLabelText("Record activity from")).toHaveValue("notice"));
    expect(getByLabelText("Keep at most (days)")).toHaveValue(0);
    expect(getByRole("switch", { name: "Mirror logs" })).toHaveAttribute("aria-checked", "false");
  });

  it("writes a changed choice to the shared settings file", async () => {
    const GlobalSettings = (await import("./GlobalSettings.svelte")).default;
    const { getByLabelText } = render(GlobalSettings);

    const select = await waitFor(() => getByLabelText("Record activity from"));
    await fireEvent.change(select, { target: { value: "info" } });
    expect(setConfig).toHaveBeenCalledWith("settings", "activityMinImpact", "info");
  });

  it("writes a number as a number, not as the input's string", async () => {
    const GlobalSettings = (await import("./GlobalSettings.svelte")).default;
    const { getByLabelText } = render(GlobalSettings);

    const input = await waitFor(() => getByLabelText("Keep at most (days)"));
    await fireEvent.change(input, { target: { value: "14" } });
    expect(setConfig).toHaveBeenCalledWith("settings", "activityMaxDays", 14);
  });

  it("writes a toggle as a boolean", async () => {
    const GlobalSettings = (await import("./GlobalSettings.svelte")).default;
    const { getByRole } = render(GlobalSettings);

    const toggle = await waitFor(() => getByRole("switch", { name: "Mirror logs" }));
    await fireEvent.click(toggle);
    expect(setConfig).toHaveBeenCalledWith("settings", "logConsole", true);
  });

  it("says what retention is acting on, and when a change takes effect", async () => {
    const GlobalSettings = (await import("./GlobalSettings.svelte")).default;
    const { getByText, findByText } = render(GlobalSettings);

    expect(await findByText(/3 segments/)).toBeInTheDocument();
    expect(getByText(/newly started/i)).toBeInTheDocument();
    expect(getByText(/rotates/i)).toBeInTheDocument();
  });

  it("reports a failed read instead of rendering an empty screen", async () => {
    globalSettingsRead.mockResolvedValueOnce({ ok: false as const, error: "no settings" } as never);
    const GlobalSettings = (await import("./GlobalSettings.svelte")).default;
    const { findByText } = render(GlobalSettings);

    expect(await findByText(/no settings/)).toBeInTheDocument();
  });
});
