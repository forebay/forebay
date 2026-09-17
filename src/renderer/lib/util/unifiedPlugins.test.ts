import { describe, it, expect } from "vitest";
import { buildUnifiedPlugins, applicableHomeIds } from "./unifiedPlugins.js";
import type { HomePlugins, CatalogEntry, PluginHome } from "@forebay/shared";

const homes: PluginHome[] = [
  { id: "forebay", label: "Forebay", dir: "/forebay", present: true, managesPlugins: true },
  { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true },
  { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true },
];
const row = (name: string, extra: Partial<HomePlugins["rows"][number]> = {}) =>
  ({ name, kind: "git" as const, enabled: true, updateAvailable: false, description: "", ...extra });

describe("buildUnifiedPlugins", () => {
  it("aggregates an installed plugin across homes with applicable-home pills", () => {
    const sections: HomePlugins[] = [
      { home: homes[1], rows: [row("wakatime-sync", { description: "Tracks time" })] },
      { home: homes[2], rows: [] },
      { home: homes[0], rows: [] },
    ];
    const catalog: CatalogEntry[] = [{ name: "wakatime-sync", url: "u", kind: "plugin", description: "cat desc", deprecated: false }];
    const out = buildUnifiedPlugins(sections, catalog, homes);
    const wk = out.find((p) => p.name === "wakatime-sync")!;
    expect(wk.kind).toBe("plugin");
    expect(wk.description).toBe("Tracks time");
    // plugin kind applies to host apps only (not forebay)
    expect(Object.keys(wk.homes).sort()).toEqual(["claude", "opencode"]);
    expect(wk.homes.claude.installed).toBe(true);
    expect(wk.homes.opencode.installed).toBe(false);
  });

  it("lists an engine the catalog omits, in every home, with its registry url", () => {
    const out = buildUnifiedPlugins([], [], homes, [{ name: "plugin-updater", url: "https://github.com/forebay/plugin-updater" }]);
    const pu = out.find((p) => p.name === "plugin-updater")!;
    expect(pu.url).toBe("https://github.com/forebay/plugin-updater");
    expect(Object.keys(pu.homes).sort()).toEqual(["claude", "forebay", "opencode"]);
  });

  it("marks a plugin external when its installed repo owner is not the marketplace org", () => {
    const sections: HomePlugins[] = [
      { home: homes[1], rows: [row("outsider", { url: "https://github.com/someone-else/outsider" }), row("wakatime-sync", { url: "https://github.com/forebay/wakatime-sync" })] },
    ];
    const out = buildUnifiedPlugins(sections, [], homes, [], "forebay");
    expect(out.find((p) => p.name === "outsider")!.external).toBe(true);
    expect(out.find((p) => p.name === "wakatime-sync")!.external).toBe(false);
  });

  it("never marks catalog or engine plugins external, and none when no org is known", () => {
    const catalog: CatalogEntry[] = [{ name: "a-plugin", url: "https://github.com/forebay/a-plugin", kind: "plugin", description: "", deprecated: false }];
    const withOrg = buildUnifiedPlugins([], catalog, homes, [{ name: "plugin-updater", url: "https://github.com/forebay/plugin-updater" }], "forebay");
    expect(withOrg.find((p) => p.name === "a-plugin")!.external).toBe(false);
    expect(withOrg.find((p) => p.name === "plugin-updater")!.external).toBe(false);
    const noOrg = buildUnifiedPlugins([{ home: homes[1], rows: [row("x", { url: "https://github.com/someone/x" })] }], [], homes);
    expect(noOrg.find((p) => p.name === "x")!.external).toBe(false);
  });

  it("routes a provider to host apps + forebay and a proxy to forebay only", () => {
    const catalog: CatalogEntry[] = [
      { name: "antigravity-auth", url: "u", kind: "provider", description: "prov", deprecated: false },
      { name: "claude-code-proxy", url: "u", kind: "proxy", description: "px", deprecated: false },
    ];
    const out = buildUnifiedPlugins([], catalog, homes);
    expect(Object.keys(out.find((p) => p.name === "antigravity-auth")!.homes).sort()).toEqual(["claude", "forebay", "opencode"]);
    expect(Object.keys(out.find((p) => p.name === "claude-code-proxy")!.homes)).toEqual(["forebay"]);
  });

  it("falls back to the catalog description when the installed row has none", () => {
    const sections: HomePlugins[] = [{ home: homes[1], rows: [row("demo", { description: "" })] }];
    const catalog: CatalogEntry[] = [{ name: "demo", url: "u", kind: "plugin", description: "from catalog", deprecated: false }];
    expect(buildUnifiedPlugins(sections, catalog, homes).find((p) => p.name === "demo")!.description).toBe("from catalog");
  });

  it("prefers installed displayName/icon, then catalog, then repo name", () => {
    const sections: HomePlugins[] = [{ home: homes[1], rows: [row("wakatime-sync", { displayName: "WakaTime", icon: "data:installed" })] }];
    const catalog: CatalogEntry[] = [{ name: "wakatime-sync", url: "u", kind: "plugin", description: "d", deprecated: false, topics: [], displayName: "Catalog Name", icon: "data:catalog" }];
    const p = buildUnifiedPlugins(sections, catalog, homes).find((x) => x.name === "wakatime-sync")!;
    expect(p.displayName).toBe("WakaTime");
    expect(p.icon).toBe("data:installed");
    const q = buildUnifiedPlugins([], [{ name: "foo-auth", url: "u", kind: "provider", description: "", deprecated: false, topics: [] }], homes).find((x) => x.name === "foo-auth")!;
    expect(q.displayName).toBe("foo-auth");
    expect(q.icon).toBe("");
  });

  it("carries catalog topics onto the unified plugin", () => {
    const catalog: CatalogEntry[] = [{ name: "antigravity-auth", url: "u", kind: "provider", description: "d", deprecated: false, topics: ["forebay", "gemini"] }];
    const out = buildUnifiedPlugins([], catalog, homes);
    expect(out.find((p) => p.name === "antigravity-auth")!.topics).toEqual(["forebay", "gemini"]);
  });

  it("includes every installed plugin, like any other, and marks updateAvailable if any home has an update", () => {
    const sections: HomePlugins[] = [{ home: homes[1], rows: [row("x", { updateAvailable: true }), row("plugin-updater")] }];
    const out = buildUnifiedPlugins(sections, [], homes);
    expect(out.some((p) => p.name === "plugin-updater")).toBe(true);
    expect(out.find((p) => p.name === "x")!.updateAvailable).toBe(true);
  });

  it("marks favorited plugins and sorts them ahead of everything else, alphabetically within each group", () => {
    const sections: HomePlugins[] = [{ home: homes[1], rows: [row("zeta"), row("alpha"), row("mid")] }];
    const out = buildUnifiedPlugins(sections, [], homes, [], "", ["zeta"]);
    expect(out.map((p) => p.name)).toEqual(["zeta", "alpha", "mid"]);
    expect(out.find((p) => p.name === "zeta")!.favorite).toBe(true);
    expect(out.find((p) => p.name === "alpha")!.favorite).toBe(false);
  });

  it("defaults every plugin to not favorite when no favorites list is given", () => {
    const out = buildUnifiedPlugins([{ home: homes[1], rows: [row("x")] }], [], homes);
    expect(out.find((p) => p.name === "x")!.favorite).toBe(false);
  });

  // The entry name (the plugins.json row / catalog name) and the manifest id a clone's own
  // plugin.json declares live in different spaces; a fixture that reuses one string for both
  // could not catch a join that silently falls back to `name`.
  it("carries the installed row's own pluginId, distinct from the entry name", () => {
    const sections: HomePlugins[] = [{ home: homes[1], rows: [row("vendor-clone-dir", { pluginId: "vendor-host-id" })] }];
    const out = buildUnifiedPlugins(sections, [], homes);
    expect(out.find((p) => p.name === "vendor-clone-dir")!.pluginId).toBe("vendor-host-id");
  });

  it("has no pluginId when nothing installed ever resolved one", () => {
    const out = buildUnifiedPlugins([{ home: homes[1], rows: [row("x")] }], [], homes);
    expect(out.find((p) => p.name === "x")!.pluginId).toBeUndefined();
  });
});

// A loader is the one plugin that is not portable: it connects a single app, the one whose
// registry entry names it. Offering it to the other app promised an install that could not work.
// A home's config DECLARES what should be installed, and the manager clones whatever is named
// there and missing. So an entry with no clone is an install that has not happened yet, and
// calling it installed offered a remove for something that is not there.
describe("a declared but absent plugin", () => {
  const withLeftover: HomePlugins[] = [
    { home: homes[1], rows: [{ name: "opencode-loader", kind: "git", enabled: true, updateAvailable: false, description: "", present: false }] },
    { home: homes[2], rows: [{ name: "opencode-loader", kind: "git", enabled: true, updateAvailable: false, description: "", present: true }] },
  ];

  it("does not count as installed in the home that only declares it", () => {
    const out = buildUnifiedPlugins(withLeftover, [], homes);
    const plugin = out.find((p) => p.name === "opencode-loader")!;
    expect(plugin.homes.claude?.installed).toBe(false);
    expect(plugin.homes.opencode?.installed).toBe(true);
  });

  // Rows predating this field carry no answer, and treating that as "not installed" would
  // empty the list for anyone whose sidecar has not caught up.
  it("treats a row that says nothing as installed", () => {
    const out = buildUnifiedPlugins(
      [{ home: homes[1], rows: [{ name: "wakatime-sync", kind: "git", enabled: true, updateAvailable: false, description: "" }] }],
      [], homes,
    );
    expect(out.find((p) => p.name === "wakatime-sync")!.homes.claude?.installed).toBe(true);
  });
});

// One app's plugins ending up installed in another is what this declaration prevents.
describe("a plugin that declares which apps it suits", () => {
  const withLoaders: PluginHome[] = [
    { id: "forebay", label: "Forebay", dir: "/k", present: true, managesPlugins: true },
    { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true, loaderId: "claude-code-loader" },
    { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true, loaderId: "opencode-loader" },
  ];

  it("is offered only to the apps it names", () => {
    expect(applicableHomeIds("plugin", withLoaders, "some-plugin", ["opencode"])).toEqual(["opencode"]);
  });

  it("declaring nothing still means any app, which is what most plugins want", () => {
    expect(applicableHomeIds("plugin", withLoaders, "some-plugin")).toEqual(["claude", "opencode"]);
    expect(applicableHomeIds("plugin", withLoaders, "some-plugin", [])).toEqual(["claude", "opencode"]);
  });

  // The declaration narrows; it cannot widen into a home the kind rules exclude.
  it("cannot claim a home its kind is not allowed in", () => {
    expect(applicableHomeIds("plugin", withLoaders, "some-plugin", ["forebay", "claude"])).toEqual(["claude"]);
  });

  it("gives a plugin naming an app that is not here no home at all", () => {
    expect(applicableHomeIds("plugin", withLoaders, "some-plugin", ["some-future-app"])).toEqual([]);
  });
});

// An app is reached through its loader, so an app without one cannot run what is installed there.
describe("an app whose loader is not installed", () => {
  const homes: PluginHome[] = [
    { id: "forebay", label: "Forebay", dir: "/k", present: true, managesPlugins: true },
    { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true, loaderId: "claude-code-loader", loaderInstalled: true },
    { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true, loaderId: "opencode-loader", loaderInstalled: false },
  ];

  it("is not offered as a target for other plugins", () => {
    expect(applicableHomeIds("plugin", homes, "some-plugin")).toEqual(["claude"]);
    expect(applicableHomeIds("provider", homes, "some-provider")).toEqual(["forebay", "claude"]);
  });

  // Otherwise the loader could never be installed: the one home that needs it would be hidden.
  it("is still offered its own loader", () => {
    expect(applicableHomeIds("loader", homes, "opencode-loader")).toEqual(["opencode"]);
  });

  it("cannot be reached by a plugin that names it either", () => {
    expect(applicableHomeIds("plugin", homes, "some-plugin", ["opencode"])).toEqual([]);
  });

  // Forebay's own home has no loader to require, and the whole list must not vanish for it.
  it("does not affect a home that has no loader at all", () => {
    expect(applicableHomeIds("provider", homes, "some-provider")).toContain("forebay");
  });

  // A sidecar predating this field sends no answer, and reading that as "absent" would
  // empty the list for anyone who has not caught up.
  it("treats a home that says nothing as reachable", () => {
    const older: PluginHome[] = [{ id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true, loaderId: "claude-code-loader" }];
    expect(applicableHomeIds("plugin", older, "some-plugin")).toEqual(["claude"]);
  });
});

describe("a loader's applicable homes", () => {
  const withLoaders: PluginHome[] = [
    { id: "forebay", label: "Forebay", dir: "/k", present: true, managesPlugins: true },
    { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true, loaderId: "claude-code-loader" },
    { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true, loaderId: "opencode-loader" },
  ];

  it("offers a loader only to the app that names it", () => {
    expect(applicableHomeIds("loader", withLoaders, "claude-code-loader")).toEqual(["claude"]);
    expect(applicableHomeIds("loader", withLoaders, "opencode-loader")).toEqual(["opencode"]);
  });

  it("leaves every other kind on the generic rule", () => {
    expect(applicableHomeIds("plugin", withLoaders, "wakatime-sync")).toEqual(["claude", "opencode"]);
    expect(applicableHomeIds("provider", withLoaders, "stub-auth")).toEqual(["forebay", "claude", "opencode"]);
    expect(applicableHomeIds("proxy", withLoaders, "claude-code-proxy")).toEqual(["forebay"]);
  });

  it("falls back to the generic rule for a loader whose app is not registered here", () => {
    expect(applicableHomeIds("loader", withLoaders, "some-other-loader")).toEqual(["claude", "opencode"]);
  });
});
