import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readPluginManifest, providerIcon } from "./pluginManifest.js";

let home: string;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

// The manifest id deliberately differs from the clone directory: a plugin is found by its
// directory and read by its manifest, and a fixture reusing one string for both would pass either way.
function writeManifest(plugin: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): void {
  const repo = join(home, "repos", plugin);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "plugin.json"), JSON.stringify({ id: `${plugin}-id`, api: 1, ...manifest }));
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(repo, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

beforeEach(() => { home = mkdtempSync(join(tmpdir(), "forebay-manifest-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("readPluginManifest", () => {
  it("resolves the plugin mark and each provider mark to a data URI", () => {
    writeManifest("antigravity-auth", {
      displayName: "Antigravity",
      icon: "icon.svg",
      icons: { antigravity: "icon.svg", "gemini-cli": "icons/gemini-cli.svg" },
    }, { "icon.svg": SVG, "icons/gemini-cli.svg": SVG });

    const manifest = readPluginManifest("antigravity-auth", home);
    expect(manifest.displayName).toBe("Antigravity");
    expect(manifest.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Object.keys(manifest.providers ?? {}).sort()).toEqual(["antigravity", "gemini-cli"]);
  });

  it("drops a mark whose file is missing rather than emitting a broken source", () => {
    writeManifest("p", { icon: "icon.svg", icons: { one: "gone.svg" } }, { "icon.svg": SVG });

    const manifest = readPluginManifest("p", home);
    expect(manifest.icon).toBeDefined();
    expect(manifest.providers).toBeUndefined();
  });

  it("is empty for a plugin with no manifest, so a logo is never a requirement", () => {
    expect(readPluginManifest("nothing-here", home)).toEqual({});
  });

  it("ignores an icons entry that is not an object of paths", () => {
    writeManifest("p", { icons: ["nope"] });
    expect(readPluginManifest("p", home).providers).toBeUndefined();
  });
});

// The chain: the provider's own mark, else the mark of the plugin deploying it, else nothing
// at all, which is what makes the renderer fall back to a lettermark.
describe("providerIcon", () => {
  it("prefers the provider's own mark", () => {
    expect(providerIcon({ icon: "plugin", providers: { "gemini-cli": "own" } }, "gemini-cli")).toBe("own");
  });

  it("falls back to the plugin's mark for a provider that declared none", () => {
    expect(providerIcon({ icon: "plugin", providers: { other: "own" } }, "gemini-cli")).toBe("plugin");
  });

  it("gives nothing when neither exists", () => {
    expect(providerIcon({}, "gemini-cli")).toBeUndefined();
  });
});
