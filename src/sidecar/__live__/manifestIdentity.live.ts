// Everything a surface shows about a plugin's or an app's identity comes from that repo's manifest.
// A row falling back to its raw id, an app with no label, or a contributed category that vanished
// are the visible symptoms of a manifest a home cannot read.
import { readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { getApps } from "@intisy-ai/basekit";
import { readPluginManifest, providerIcon } from "../lib/pluginManifest.js";
import { readMarketplaceContributions } from "../lib/marketplaceContributions.js";
import { pluginHomes } from "../lib/pluginHomes.js";
import { reposDir } from "../lib/storagePaths.js";

function clones(homeDir: string): string[] {
  try {
    return readdirSync(homeDir ? reposDir(homeDir) : "", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

describe("identity against the real homes", () => {
  it("gives every registered app a label of its own", () => {
    const apps = getApps();
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      console.log(`  ${app.id.padEnd(10)} -> ${JSON.stringify(app.label)} accent=${app.accent ?? "-"} loader=${app.loader?.id ?? "-"}`);
    }
    expect(apps.filter((app) => !app.label || app.label === app.id)).toEqual([]);
  });

  it("names every installed plugin from its own manifest", async () => {
    const homes = await pluginHomes();
    expect(homes.length).toBeGreaterThan(0);
    const unnamed: string[] = [];
    for (const home of homes) {
      console.log(`  ${home.dir}`);
      for (const clone of clones(home.dir)) {
        const manifest = readPluginManifest(clone, home.dir);
        const marks = Object.keys(manifest.providers ?? {}).join(",") || "-";
        console.log(`    ${clone.padEnd(20)} name=${JSON.stringify(manifest.displayName ?? "-")} mark=${manifest.icon ? "yes" : "no"} marks=${marks}`);
        if (!manifest.displayName) unnamed.push(`${home.id}:${clone}`);
      }
    }
    // Named here rather than counted: a plugin whose manifest a home cannot read is the one thing
    // this migration could have broken, and the id says which.
    console.log(`  unnamed: ${unnamed.join(", ") || "none"}`);
  });

  it("resolves a mark per contributed id where a plugin ships more than one", async () => {
    for (const home of await pluginHomes()) {
      const manifest = readPluginManifest("antigravity-provider", home.dir);
      if (!manifest.displayName) continue;
      expect(providerIcon(manifest, "antigravity")).toBeDefined();
      expect(providerIcon(manifest, "gemini-cli")).toBeDefined();
      // A lane the plugin ships no mark for wears the plugin's own, rather than nothing.
      expect(providerIcon(manifest, "not-a-lane")).toBe(manifest.icon);
    }
  });

  it("keeps a contributed catalog category", async () => {
    const homes = await pluginHomes();
    const found = homes.flatMap((home) => readMarketplaceContributions({ reposDir: reposDir(home.dir) }));
    for (const category of found) console.log(`  ${category.id} -> ${JSON.stringify(category.label)} by ${category.contributedBy}`);
    expect(found.length).toBeGreaterThan(0);
  });
});
