import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { prerequisiteInstalls } from "./installQueue.js";
import { rows, resetDownloadsForTest, seedJobsForTest } from "../downloads.js";

const engines = [
  { id: "plugin-updater", capability: "plugin-management", url: "https://example/plugin-updater", homes: {} },
  { id: "custom-provider", capability: "custom-endpoints", url: "https://example/custom-provider", homes: {} },
];
const homes = [
  { id: "claude", label: "Claude", dir: "/c", present: true, managesPlugins: false },
  { id: "opencode", label: "OpenCode", dir: "/o", present: true, managesPlugins: true },
];

describe("prerequisiteInstalls", () => {
  it("names the manager for a home that lacks it", () => {
    expect(prerequisiteInstalls("wakatime-sync", ["claude"], homes, engines)).toEqual([
      { homeId: "claude", id: "plugin-updater", url: "https://example/plugin-updater" },
    ]);
  });

  it("returns nothing for a home that already has it", () => {
    expect(prerequisiteInstalls("wakatime-sync", ["opencode"], homes, engines)).toEqual([]);
  });

  it("skips homes that already have it and keeps the order of the rest", () => {
    const lacking = [...homes, { id: "extra", label: "Extra", dir: "/e", present: true, managesPlugins: false }];
    const result = prerequisiteInstalls("wakatime-sync", ["extra", "opencode", "claude"], lacking, engines);
    expect(result.map((p) => p.homeId)).toEqual(["extra", "claude"]);
  });

  it("returns nothing when the plugin being installed is itself an engine", () => {
    expect(prerequisiteInstalls("plugin-updater", ["claude"], homes, engines)).toEqual([]);
    expect(prerequisiteInstalls("custom-provider", ["claude"], homes, engines)).toEqual([]);
  });

  it("returns nothing when no engine declares the capability", () => {
    expect(prerequisiteInstalls("wakatime-sync", ["claude"], homes, [])).toEqual([]);
  });

  it("ignores a home id it does not know", () => {
    expect(prerequisiteInstalls("wakatime-sync", ["ghost"], homes, engines)).toEqual([]);
  });
});

// Ordering is the sidecar queue's guarantee now (see src/sidecar/jobs/runner.test.ts).
// What the renderer owns is showing that order faithfully.
describe("the mirrored queue", () => {
  it("shows the manager installing and the plugin waiting behind it", () => {
    resetDownloadsForTest();
    seedJobsForTest([
      { id: "j1", kind: "install", plugin: "plugin-updater", url: "u", home: "claude", status: "running", phase: "downloading", percent: 10, phases: [], samples: [], queuedAt: 1 },
      { id: "j2", kind: "install", plugin: "wakatime-sync", url: "u", home: "claude", status: "queued", phase: "", percent: -1, phases: [], samples: [], queuedAt: 2 },
    ]);
    const shown = get(rows);
    expect(shown.map((r) => [r.plugin, r.status])).toEqual([
      ["plugin-updater", "installing"],
      ["wakatime-sync", "pending"],
    ]);
  });
});
