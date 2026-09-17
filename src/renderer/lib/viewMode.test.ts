// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubForebay } from "./testing.js";
import { loadViewMode, saveViewMode } from "./viewMode.js";

describe("viewMode", () => {
  beforeEach(() => stubForebay({}));
  it("defaults to list when unset", async () => {
    stubForebay({ getConfig: async () => ({ ok: true, data: undefined }) });
    expect(await loadViewMode("providers")).toBe("list");
  });
  it("returns the stored grid mode", async () => {
    stubForebay({ getConfig: async () => ({ ok: true, data: "grid" }) });
    expect(await loadViewMode("providers")).toBe("grid");
  });
  it("defaults to list on a failed read", async () => {
    stubForebay({ getConfig: async () => ({ ok: false, error: "boom" }) });
    expect(await loadViewMode("providers")).toBe("list");
  });
  it("saves the per-screen key", async () => {
    const setConfig = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({ setConfig });
    await saveViewMode("apps", "grid");
    expect(setConfig).toHaveBeenCalledWith("forebay", "viewMode.apps", "grid");
  });
});
