import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { sent, forks, fakeFork } = vi.hoisted(() => {
  const sent: Array<Record<string, unknown>> = [];
  const forks: Array<{ handlers: Record<string, (arg?: unknown) => void> }> = [];
  const fakeFork = () => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    forks.push({ handlers });
    return {
      stdout: null,
      stderr: null,
      pid: 4242,
      on: (event: string, cb: (arg?: unknown) => void) => { handlers[event] = cb; },
      send: (message: Record<string, unknown>) => { sent.push(message); },
      kill: () => {},
    };
  };
  return { sent, forks, fakeFork };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, fork: fakeFork };
});

// A from-scratch bootstrap installs the manager into a home before anything is deployed
// there, so the catalog (what a marketplace DECLARES) has to answer this, not the deployed
// manifests (what a home already HAS).
vi.mock("../lib/capabilityCatalog.js", () => ({
  repoProvidingCapability: async (_dir: string, capability: string) =>
    capability === "plugin-management"
      ? { id: "plugin-updater", npmName: "plugin-updater", url: "https://example/plugin-updater", capabilities: ["plugin-management"], description: "", sourceId: "s" }
      : null,
}));

import { jobsEnqueue } from "./jobs.js";

let home: string;
let prevEnv: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "forebay-jobs-"));
  prevEnv = process.env.HUB_CONFIG_DIR;
  process.env.HUB_CONFIG_DIR = home;
  sent.length = 0;
  forks.length = 0;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.HUB_CONFIG_DIR;
  else process.env.HUB_CONFIG_DIR = prevEnv;
  rmSync(home, { recursive: true, force: true });
});

function homesIn(root: string) {
  return [
    { id: "forebay", label: "Forebay", dir: join(root, "forebay"), present: true, managesPlugins: false },
    { id: "app-a", label: "App A", dir: join(root, "app-a"), present: true, managesPlugins: false },
  ];
}

// The runner's single active-job slot is process-wide (jobs.ts keeps one real runner for
// the whole sidecar), so each test finishes its own job before the next one enqueues.
function finishActiveJob(): void {
  const active = forks[forks.length - 1];
  const jobId = sent[sent.length - 1]?.jobId;
  active.handlers.message?.({ jobId, done: true });
  active.handlers.exit?.(0);
}

describe("jobsEnqueue", () => {
  it("marks a from-scratch bootstrap install of the manager as the plugin manager, before anything is deployed", async () => {
    const homes = homesIn(home);
    try {
      const result = await jobsEnqueue("install", "plugin-updater", "https://example/plugin-updater", "app-a", { homes });
      expect(result.ok).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ plugin: "plugin-updater", isPluginManager: true });
    } finally {
      finishActiveJob();
    }
  });

  it("does not mark an unrelated plugin as the manager", async () => {
    const homes = homesIn(home);
    try {
      const result = await jobsEnqueue("install", "wakatime-sync", "https://example/wakatime-sync", "app-a", { homes });
      expect(result.ok).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ plugin: "wakatime-sync", isPluginManager: false });
    } finally {
      finishActiveJob();
    }
  });
});
