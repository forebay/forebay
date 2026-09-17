import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deployedManifests,
  ownerOfCapability,
  pluginProvidesCapability,
  isDeployedPlugin,
  pluginIdFromClone,
  unmanifestedPlugins,
} from "./capabilityOwner.js";

// Pinned so the registry lookup behind pluginDir() cannot read the developer's real apps.json.
// HUB_APPS_FILE is the one that matters here; it is read live per call, so no reimport is needed.
const registryHome = mkdtempSync(join(tmpdir(), "forebay-caps-registry-"));
process.env.HUB_CONFIG_DIR = registryHome;
process.env.HUB_APPS_FILE = join(registryHome, "apps.json");

function homeWith(sidecars: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "forebay-caps-"));
  const dir = join(home, "plugin");
  mkdirSync(dir, { recursive: true });
  for (const [id, manifest] of Object.entries(sidecars)) {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(manifest));
    writeFileSync(join(dir, `${id}.js`), "export default {};");
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return home;
}

// A bundle deployed with no sidecar beside it, the shape a pre-sidecar deploy left behind.
function homeWithBundleOnly(name: string): string {
  const home = mkdtempSync(join(tmpdir(), "forebay-caps-bundle-"));
  mkdirSync(join(home, "plugin"), { recursive: true });
  writeFileSync(join(home, "plugin", `${name}.js`), "export default {};");
  return home;
}

function withClone(home: string, repo: string, manifest: unknown): string {
  const dir = join(home, "repos", repo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest));
  return home;
}

describe("capability ownership from the deployed sidecars", () => {
  it("names the plugin whose manifest declares a capability", () => {
    const home = homeWith({
      alpha: { id: "alpha", api: 1, entry: "dist/index.js", capabilities: ["screens"] },
      beta: { id: "beta", api: 1, entry: "dist/index.js", capabilities: ["custom-endpoints"], permissions: ["network"] },
    });
    expect(ownerOfCapability(home, "custom-endpoints")).toBe("beta");
    expect(pluginProvidesCapability(home, "alpha", "screens")).toBe(true);
    expect(pluginProvidesCapability(home, "alpha", "custom-endpoints")).toBe(false);
  });

  it("carries each manifest's declared permissions", () => {
    const home = homeWith({ beta: { id: "beta", api: 1, entry: "dist/index.js", capabilities: ["custom-endpoints"], permissions: ["network"] } });
    expect(deployedManifests(home)).toEqual([
      { id: "beta", capabilities: ["custom-endpoints"], permissions: ["network"], configName: "beta", configDefaults: null, dataPaths: [], entryPath: join(home, "plugin", "beta.js") },
    ]);
  });

  it("carries the settings a manifest declares, and null for one declaring none", () => {
    const home = homeWith({
      bare: { id: "bare", api: 1, entry: "dist/index.js" },
      settled: { id: "settled", api: 1, entry: "dist/index.js", config: { defaults: { interval: 60, logging: true } } },
    });
    const byId = new Map(deployedManifests(home).map((plugin) => [plugin.id, plugin.configDefaults]));
    expect(byId.get("settled")).toEqual({ interval: 60, logging: true });
    expect(byId.get("bare")).toBeNull();
  });

  it("carries the paths a manifest declares this plugin writes to", () => {
    const home = homeWith({
      spread: { id: "spread", api: 1, entry: "dist/index.js", data: { paths: ["state/mirror", "cache/tiles"] } },
    });
    expect(deployedManifests(home)[0].dataPaths).toEqual(["state/mirror", "cache/tiles"]);
  });

  it("answers null for a capability nothing declares and for an unreadable home", () => {
    expect(ownerOfCapability(homeWith({}), "screens")).toBeNull();
    expect(ownerOfCapability(join(tmpdir(), "forebay-caps-absent"), "screens")).toBeNull();
    expect(deployedManifests(join(tmpdir(), "forebay-caps-absent"))).toEqual([]);
  });

  it("does not treat the deploy directory's own package.json as a plugin", () => {
    const home = homeWith({ alpha: { id: "alpha", api: 1, entry: "dist/index.js", capabilities: ["screens"] } });
    // A valid manifest at that filename, so only the by-name skip can exclude it: the id schema
    // permits an id of "package", and the marker owns that filename.
    writeFileSync(join(home, "plugin", "package.json"), JSON.stringify({ id: "package", api: 1, entry: "dist/index.js", capabilities: [] }));
    expect(deployedManifests(home).map((m) => m.id)).toEqual(["alpha"]);
    expect(isDeployedPlugin(home, "package")).toBe(false);
    expect(isDeployedPlugin(home, "alpha")).toBe(true);
  });
});

describe("capability ownership falls back to a clone's own plugin.json", () => {
  it("resolves a capability from the clone when the bundle has no sidecar", () => {
    const home = withClone(homeWithBundleOnly("gateway"), "gateway", { id: "gateway", capabilities: ["front-door"] });
    expect(ownerOfCapability(home, "front-door")).toBe("gateway");
    expect(pluginProvidesCapability(home, "gateway", "front-door")).toBe(true);
  });

  it("does not resolve a capability neither the sidecar nor the clone declares", () => {
    const home = homeWithBundleOnly("gateway");
    expect(ownerOfCapability(home, "front-door")).toBeNull();
    expect(pluginProvidesCapability(home, "gateway", "front-door")).toBe(false);
  });

  it("reads pluginIdFromClone's own id over the directory name", () => {
    const home = withClone(mkdtempSync(join(tmpdir(), "forebay-caps-clone-")), "gateway-clone-dir", { id: "gateway" });
    expect(pluginIdFromClone("gateway-clone-dir", home)).toBe("gateway");
    expect(pluginIdFromClone("nothing-here", home)).toBe("nothing-here");
  });
});

describe("unmanifestedPlugins", () => {
  it("names an installed plugin whose bundle has no manifest from either source", () => {
    const home = homeWithBundleOnly("gateway");
    expect(unmanifestedPlugins(home, ["gateway", "other"])).toEqual(["gateway"]);
  });

  it("clears once the clone's own plugin.json is readable", () => {
    const home = withClone(homeWithBundleOnly("gateway"), "gateway", { id: "gateway", capabilities: [] });
    expect(unmanifestedPlugins(home, ["gateway"])).toEqual([]);
  });

  it("names nothing for a name with no deployed bundle", () => {
    expect(unmanifestedPlugins(homeWithBundleOnly("gateway"), ["never-deployed"])).toEqual([]);
  });
});

describe("the file a plugin's settings live in", () => {
  it("is the name the manifest gives when that is not the id, and the id otherwise", () => {
    const home = homeWith({
      renamed: { id: "renamed", api: 1, entry: "dist/index.js", config: { name: "legacy-name", defaults: { a: 1 } } },
      plain: { id: "plain", api: 1, entry: "dist/index.js", config: { defaults: { b: 2 } } },
    });
    const byId = new Map(deployedManifests(home).map((plugin) => [plugin.id, plugin.configName]));
    expect(byId.get("renamed")).toBe("legacy-name");
    expect(byId.get("plain")).toBe("plain");
  });
});
