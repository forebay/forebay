// The regression test for the whole job-runner change: a real install must not stop the
// sidecar answering. Before the worker existed, plugin-updater's execSync ran on this very
// event loop and a single npm build blocked every other RPC past its deadline.
//
//   npx vitest run --config vitest.live.config.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INSTALLER_PATH_ENV } from "../jobs/runner.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";
import { reposDir, pluginDir } from "../lib/storagePaths.js";

const MANAGER_URL = "https://github.com/forebay/plugin-updater";

let root: string;
let homes: PluginHome[];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cairn-jobs-"));
  homes = [
    { id: "cairn", label: "Cairn", dir: join(root, "cairn"), present: true, managesPlugins: false },
    { id: "claude", label: "Claude Code", dir: join(root, "claude"), present: true, managesPlugins: false },
  ];
  process.env.HUB_CONFIG_DIR = homes[0].dir;
  // Running from source, the built worker is not a sibling of this module.
  process.env[INSTALLER_PATH_ENV] = resolve("out/main/installer.js");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("a running job and the sidecar", () => {
  it("keeps answering other requests while an install runs, and reports real phases", async () => {
    if (!existsSync(process.env[INSTALLER_PATH_ENV] ?? "")) throw new Error("run npm run build first");

    const { jobsEnqueue, jobsList } = await import("../modules/jobs.js");
    const { pluginsList } = await import("../modules/plugins.js");

    const queued = await jobsEnqueue("install", "plugin-updater", MANAGER_URL, "claude", { homes });
    expect(queued.ok, queued.ok ? "" : String(queued.error)).toBe(true);
    if (!queued.ok) return;

    const phases = new Set<string>();
    const latencies: number[] = [];
    let done = false;

    // Poll another handler while the install works. Each call must return promptly; if the
    // install were still running in this process, these would queue behind it for minutes.
    while (!done) {
      const started = Date.now();
      const listed = await pluginsList({ homes });
      latencies.push(Date.now() - started);
      expect(listed.ok).toBe(true);

      const jobs = await jobsList();
      if (jobs.ok) {
        const job = jobs.data.find((j) => j.id === queued.data.id);
        if (job?.phase) phases.add(job.phase);
        done = !!job && ["done", "failed", "cancelled"].includes(job.status);
        if (job?.status === "failed") throw new Error(`the install failed: ${job.error}`);
      }
      if (!done) await new Promise((r) => setTimeout(r, 100));
    }

    const worst = Math.max(...latencies);
    console.log(`answered ${latencies.length} requests during the install, worst ${worst}ms, phases: ${[...phases].join(" -> ")}`);
    // A blocked loop shows up as one enormous latency, not as a slow average.
    expect(worst).toBeLessThan(2000);
    expect(latencies.length).toBeGreaterThan(5);
    expect(phases.size).toBeGreaterThan(1);

    const home = homes[1].dir;
    expect(existsSync(join(reposDir(home), "plugin-updater")), "clone landed").toBe(true);
    expect(existsSync(join(pluginDir(home), "plugin-updater.js")), "bundle deployed").toBe(true);
    expect(existsSync(join(home, "settings.json")), "registered with the app").toBe(true);
  }, 600_000);

  it("cancels a running install and leaves the home as it was", async () => {
    const { jobsEnqueue, jobsCancel, jobsList } = await import("../modules/jobs.js");
    const target = homes[0];

    const queued = await jobsEnqueue("install", "plugin-updater", MANAGER_URL, target.id, { homes });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;

    // Let it get far enough to have written something, then pull the plug.
    await new Promise((r) => setTimeout(r, 3000));
    expect((await jobsCancel(queued.data.id)).ok).toBe(true);

    for (let i = 0; i < 100; i++) {
      const jobs = await jobsList();
      const job = jobs.ok ? jobs.data.find((j) => j.id === queued.data.id) : undefined;
      if (job && ["cancelled", "done", "failed"].includes(job.status)) {
        expect(job.status, `rollback error: ${job.error ?? "none"}`).toBe("cancelled");
        expect(job.error ?? "").not.toContain("rollback failed");
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(existsSync(join(reposDir(target.dir), "plugin-updater")), "clone rolled back").toBe(false);
  }, 600_000);

  it("reports real byte throughput read from git during a clone", async () => {
    const { jobsEnqueue, jobsList } = await import("../modules/jobs.js");
    const target = homes[1];
    const queued = await jobsEnqueue("install", "stub-auth", "https://github.com/forebay/stub-auth", target.id, { homes });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;

    let peak = 0;
    let bytes = 0;
    let samples = 0;
    const percents: number[] = [];
    for (let i = 0; i < 600; i++) {
      const jobs = await jobsList();
      const job = jobs.ok ? jobs.data.find((j) => j.id === queued.data.id) : undefined;
      if (job) {
        peak = Math.max(peak, job.bytesPerSecond ?? 0);
        bytes = Math.max(bytes, job.bytes ?? 0);
        samples = Math.max(samples, job.samples.length);
        if (job.percent >= 0) percents.push(job.percent);
        if (["done", "failed", "cancelled"].includes(job.status)) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log(`transfer: ${bytes} bytes, peak ${peak} B/s, ${samples} rate samples`);
    expect(bytes, "git reported a byte count").toBeGreaterThan(0);
    expect(peak, "git reported a rate").toBeGreaterThan(0);
    expect(samples, "rate samples were kept for charting").toBeGreaterThan(1);
    // Monotonic progress is what makes the bar usable.
    expect(percents.every((p, i) => i === 0 || p >= percents[i - 1])).toBe(true);
  }, 600_000);
});
