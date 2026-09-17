import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { router, navigate, consumeParams, back, forward, nav, SCREENS, pluginScreen, pluginOfScreen, setPluginScreens } from "./router.js";
import type { PluginScreen } from "@forebay/shared";

function screen(plugin: string, label: string): PluginScreen {
  return { plugin, id: "main", label, homes: ["claude"], layout: { kind: "text" } };
}

describe("router", () => {
  it("defaults to the overview screen", () => {
    expect(get(router).screen).toBe("overview");
  });

  it("updates the screen on navigate", () => {
    navigate("providers");
    expect(get(router).screen).toBe("providers");
    navigate("overview");
    expect(get(router).screen).toBe("overview");
  });

  it("lists every screen exactly once, in a stable order", () => {
    const ids = SCREENS.map((screen) => screen.id);
    expect(ids).toEqual(["overview", "providers", "accounts", "routing", "usage", "activity", "localApi", "apps", "plugins", "libraries", "downloads", "settings"]);
  });

  it("navigate with params stores them and consumeParams exposes them once", () => {
    navigate("plugins", { add: "1" });
    expect(get(router).screen).toBe("plugins");
    expect(get(router).params).toEqual({ add: "1" });

    const params = consumeParams();
    expect(params).toEqual({ add: "1" });

    const secondCall = consumeParams();
    expect(secondCall).toBeUndefined();
    expect(get(router).params).toBeUndefined();
  });

  it("consumeParams does not notify subscribers when there are no params", () => {
    navigate("plugins");
    let notifications = 0;
    const unsub = router.subscribe(() => notifications++);
    notifications = 0;
    const result = consumeParams();
    unsub();
    expect(result).toBeUndefined();
    expect(notifications).toBe(0);
  });

  it("navigate without params clears any prior params", () => {
    navigate("apps", { app: "claude" });
    expect(get(router).params).toEqual({ app: "claude" });

    navigate("overview");
    expect(get(router).params).toBeUndefined();
  });

  it("back and forward move through navigation history and expose can-back/can-forward", () => {
    navigate("overview");
    navigate("providers");
    navigate("usage");
    expect(get(nav).canBack).toBe(true);
    expect(get(nav).canForward).toBe(false);
    expect(get(nav).backLabel).toBe("Providers");

    back();
    expect(get(router).screen).toBe("providers");
    expect(get(nav).canForward).toBe(true);

    back();
    expect(get(router).screen).toBe("overview");

    forward();
    expect(get(router).screen).toBe("providers");

    forward();
    expect(get(router).screen).toBe("usage");
    expect(get(nav).canForward).toBe(false);
  });

  it("navigating after going back drops the forward history", () => {
    navigate("overview");
    navigate("providers");
    back();
    expect(get(nav).canForward).toBe(true);
    navigate("accounts");
    expect(get(nav).canForward).toBe(false);
    expect(get(router).screen).toBe("accounts");
  });

  it("marks a screen redirected only when navigate is asked to redirect", () => {
    navigate("overview");
    navigate("providers");
    expect(get(nav).redirected).toBe(false);

    navigate("plugins", { add: "1" }, { redirect: true });
    expect(get(nav).redirected).toBe(true);
    expect(get(nav).redirectLabel).toBe("Providers");

    navigate("accounts");
    expect(get(nav).redirected).toBe(false);
  });

  it("clears the redirected flag on back", () => {
    navigate("overview");
    navigate("usage", undefined, { redirect: true });
    expect(get(nav).redirected).toBe(true);
    back();
    expect(get(nav).redirected).toBe(false);
  });

  it("navigating to the same screen does not add a history entry", () => {
    navigate("overview");
    navigate("providers");
    navigate("providers");
    back();
    expect(get(router).screen).toBe("overview");
  });
});

describe("plugin-contributed screens", () => {
  it("navigates to a screen a plugin contributed", () => {
    navigate(pluginScreen("config-ledger", "main"));
    expect(get(router).screen).toBe("plugin:config-ledger:main");
    expect(pluginOfScreen(get(router).screen)).toEqual({ plugin: "config-ledger", screenId: "main" });
  });

  it("reports no plugin for one of Forebay's own screens", () => {
    expect(pluginOfScreen("settings")).toBeNull();
  });

  // History labels come from the contributed screen, so "Back to ..." names the screen
  // the user actually saw rather than a raw id.
  it("names a contributed screen in history from its declared label", () => {
    setPluginScreens([screen("config-ledger", "Ledger")]);
    navigate(pluginScreen("config-ledger", "main"));
    navigate("overview", undefined, { redirect: true });
    expect(get(nav).redirectLabel).toBe("Ledger");
    expect(get(nav).backLabel).toBe("Ledger");
  });

  it("falls back to the plugin name when no screen is known yet", () => {
    setPluginScreens([]);
    navigate(pluginScreen("wakatime-sync", "main"));
    navigate("overview", undefined, { redirect: true });
    expect(get(nav).redirectLabel).toBe("wakatime-sync");
  });
});
