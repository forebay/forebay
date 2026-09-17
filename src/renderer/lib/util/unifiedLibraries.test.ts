import { describe, it, expect } from "vitest";
import { buildUnifiedLibraries, isOrphan, orphanHomeIds } from "./unifiedLibraries.js";
import type { HomeLibraries, InstalledLibrary, PluginHome } from "@forebay/shared";

function home(id: string, label: string): PluginHome {
  return { id, label, dir: `/${id}`, present: true, managesPlugins: true };
}

function lib(specifier: string, version: string, usedBy: string[] = []): InstalledLibrary {
  return { specifier, version, usedBy };
}

describe("buildUnifiedLibraries", () => {
  // The whole point: the same library in two homes was listed twice, which read as two
  // libraries rather than one installed in two places.
  it("lists a library installed in two homes once, naming both homes", () => {
    const rows = buildUnifiedLibraries([
      { home: home("alpha", "Alpha"), shared: [lib("@intisy-ai/basekit", "1.2.0", ["antigravity-auth"])], plugins: [] },
      { home: home("beta", "Beta"), shared: [lib("@intisy-ai/basekit", "1.1.0", ["claude-code-auth"])], plugins: [] },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].specifier).toBe("@intisy-ai/basekit");
    expect(Object.keys(rows[0].homes).sort()).toEqual(["alpha", "beta"]);
  });

  // Two homes really can hold different versions, so one version per row would be a claim the
  // data does not support.
  it("keeps each home's own version", () => {
    const rows = buildUnifiedLibraries([
      { home: home("alpha", "Alpha"), shared: [lib("@intisy-ai/basekit", "1.2.0")], plugins: [] },
      { home: home("beta", "Beta"), shared: [lib("@intisy-ai/basekit", "1.1.0")], plugins: [] },
    ]);
    expect(rows[0].homes.alpha.version).toBe("1.2.0");
    expect(rows[0].homes.beta.version).toBe("1.1.0");
  });

  it("merges the plugins that use it across homes, without repeating one", () => {
    const rows = buildUnifiedLibraries([
      { home: home("alpha", "Alpha"), shared: [lib("@intisy-ai/basekit/auth", "1.0.0", ["antigravity-auth", "claude-code-auth"])], plugins: [] },
      { home: home("beta", "Beta"), shared: [lib("@intisy-ai/basekit/auth", "1.0.0", ["claude-code-auth"])], plugins: [] },
    ]);
    expect(rows[0].usedBy).toEqual(["antigravity-auth", "claude-code-auth"]);
  });

  // A plugin's declared dependency that never reached the shared store still deserves a row,
  // and the row has to say it is not installed rather than implying it is.
  it("records a declared dependency as declared but not installed", () => {
    const rows = buildUnifiedLibraries([
      {
        home: home("alpha", "Alpha"),
        shared: [],
        plugins: [{ plugin: "custom-auth", dependencies: [lib("@openauthjs/openauth", "")] }],
      },
    ]);

    expect(rows[0].specifier).toBe("@openauthjs/openauth");
    expect(rows[0].declaredBy).toEqual(["custom-auth"]);
    expect(rows[0].homes.alpha.installed).toBe(false);
  });

  it("sorts rows by specifier so the list does not reorder between reads", () => {
    const rows = buildUnifiedLibraries([
      { home: home("alpha", "Alpha"), shared: [lib("zed", "1"), lib("apex", "1")], plugins: [] },
    ]);
    expect(rows.map((r) => r.specifier)).toEqual(["apex", "zed"]);
  });

  it("returns nothing for homes with empty stores", () => {
    expect(buildUnifiedLibraries([{ home: home("alpha", "Alpha"), shared: [], plugins: [] }])).toEqual([]);
  });
});

describe("isOrphan", () => {
  it("calls a library nothing declares an orphan, and one in use not", () => {
    const rows = buildUnifiedLibraries([
      {
        home: home("alpha", "Alpha"),
        shared: [lib("@intisy-ai/left-behind", "1.0.0"), lib("@intisy-ai/basekit", "1.0.0", ["antigravity-auth"])],
        plugins: [],
      },
    ]);
    const orphan = rows.find((r) => r.specifier === "@intisy-ai/left-behind")!;
    const used = rows.find((r) => r.specifier === "@intisy-ai/basekit")!;
    expect(isOrphan(orphan)).toBe(true);
    expect(isOrphan(used)).toBe(false);
  });
});

// A library can be load-bearing in one home and left over in another: uninstalling its last
// consumer there leaves the store entry behind. Merging the two answers made the leftover
// unremovable, because the row claimed a user it only had elsewhere.
describe("orphanHomeIds", () => {
  const rows = () => buildUnifiedLibraries([
    { home: home("alpha", "Alpha"), shared: [lib("@intisy-ai/openai-translator", "0.1.1", ["custom-auth"])], plugins: [] },
    { home: home("beta", "Beta"), shared: [lib("@intisy-ai/openai-translator", "0.1.1")], plugins: [] },
  ]);

  it("keeps each home's own answer to who uses it", () => {
    const [library] = rows();
    expect(library.homes.alpha.usedBy).toEqual(["custom-auth"]);
    expect(library.homes.beta.usedBy).toEqual([]);
  });

  it("names only the homes where nothing declares it", () => {
    expect(orphanHomeIds(rows()[0])).toEqual(["beta"]);
  });

  it("is not an orphan overall while one home still uses it", () => {
    expect(isOrphan(rows()[0])).toBe(false);
  });

  it("ignores a home that does not hold it, so a declared-but-uninstalled row is not removable", () => {
    const [library] = buildUnifiedLibraries([
      { home: home("alpha", "Alpha"), shared: [], plugins: [{ plugin: "custom-auth", dependencies: [lib("@openauthjs/openauth", "0.4.3")] }] },
    ]);
    expect(orphanHomeIds(library)).toEqual([]);
  });

  it("names every home for a library nothing uses anywhere", () => {
    const [library] = buildUnifiedLibraries([
      { home: home("alpha", "Alpha"), shared: [lib("@intisy-ai/left-behind", "1.0.0")], plugins: [] },
      { home: home("beta", "Beta"), shared: [lib("@intisy-ai/left-behind", "1.0.0")], plugins: [] },
    ]);
    expect(orphanHomeIds(library)).toEqual(["alpha", "beta"]);
  });
});
