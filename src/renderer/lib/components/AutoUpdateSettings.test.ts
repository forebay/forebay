// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

const configWrite = vi.fn(async () => ({ ok: true as const, data: undefined }));

vi.mock("../ipc.js", () => ({
  forebay: {
    get configWrite() { return configWrite; },
  },
}));

beforeEach(() => {
  configWrite.mockClear();
});

// A neutral id on purpose: these controls belong to whichever plugin manages the home's plugins,
// and the component must follow the schema rather than a name it knows.
const SCHEMA = {
  plugin: "manager",
  defaults: { auto_update_mode: "update", auto_update_triggers: { loader: true, app: true, forebay: true } },
  current: { auto_update_mode: "check", auto_update_triggers: { loader: true, app: true, forebay: true } },
};

describe("AutoUpdateSettings", () => {
  it("shows the mode this app home has on disk", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, { props: { homeId: "claude", schema: SCHEMA } });

    expect(getByLabelText("Automatic updates")).toHaveValue("check");
  });

  it("writes a mode change to that app's own manager config", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, { props: { homeId: "claude", schema: SCHEMA } });

    const select = getByLabelText("Automatic updates");
    await fireEvent.change(select, { target: { value: "update" } });
    expect(configWrite).toHaveBeenCalledWith("claude", "manager", "auto_update_mode", "update");
  });

  it("writes to whichever plugin the schema names, not to one it knows", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, {
      props: { homeId: "claude", schema: { ...SCHEMA, plugin: "some-other-manager" } },
    });

    await fireEvent.change(getByLabelText("Automatic updates"), { target: { value: "off" } });
    expect(configWrite).toHaveBeenCalledWith("claude", "some-other-manager", "auto_update_mode", "off");
  });

  it("writes nothing at all when no plugin in this home manages plugins", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, { props: { homeId: "claude", schema: null } });

    await fireEvent.change(getByLabelText("Automatic updates"), { target: { value: "off" } });
    expect(configWrite).not.toHaveBeenCalled();
  });

  it("writes a trigger toggle as the whole object, since it is one config key", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByRole } = render(AutoUpdateSettings, { props: { homeId: "claude", schema: SCHEMA } });

    const toggle = getByRole("switch", { name: "Check when this app starts" });
    await fireEvent.click(toggle);
    expect(configWrite).toHaveBeenCalledWith("claude", "manager", "auto_update_triggers", {
      loader: true, app: false, forebay: true,
    });
  });

  it("falls back to check when the home only has the older launch flag", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, {
      props: { homeId: "opencode", schema: { plugin: "manager", defaults: {}, current: { update_on_launch: false } } },
    });

    expect(getByLabelText("Automatic updates")).toHaveValue("check");
  });

  it("renders the declared defaults while the home has no stored settings yet", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, { props: { homeId: "claude", schema: null } });

    expect(getByLabelText("Automatic updates")).toHaveValue("update");
  });

  it("reflects a mode change immediately, before the write comes back", async () => {
    const AutoUpdateSettings = (await import("./AutoUpdateSettings.svelte")).default;
    const { getByLabelText } = render(AutoUpdateSettings, { props: { homeId: "claude", schema: SCHEMA } });

    await fireEvent.change(getByLabelText("Automatic updates"), { target: { value: "off" } });
    expect(getByLabelText("Automatic updates")).toHaveValue("off");
  });
});
