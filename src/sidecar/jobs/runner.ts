import { fork, execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { activityEnv } from "@intisy-ai/basekit";
import { newJob, nextRunnable, applyEvent, cancelJob, isEnded, noteTransfer } from "./model.js";
import type { Job, JobSpec, Rollback } from "./model.js";
import { parseGitProgress } from "./gitProgress.js";
import { parseWorkerPhase } from "./workerPhase.js";
import { invokePluginManagement, listedPlugins } from "../lib/pluginManager.js";
import { reposDir, pluginDir } from "../lib/storagePaths.js";

// What the worker is told to do. Mirrors src/installer/index.ts's JobMessage.
export interface JobMessage extends JobSpec {
  jobId: string;
  homeDir: string;
  isPluginManager: boolean;
  autoUpdate: boolean;
}

export interface WorkerHandle {
  onMessage(fn: (message: unknown) => void): void;
  // git writes its transfer progress to stderr, which is the only real byte count available.
  onStderr?(fn: (chunk: string) => void): void;
  onExit(fn: (code: number | null) => void | Promise<void>): void;
  kill(): void;
}

export interface RunnerDeps {
  spawnWorker?: (job: Job, message: JobMessage) => WorkerHandle;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  onChange?: (job: Job) => void;
  resolveHome?: (homeId: string) => { dir: string };
  isPluginManager?: (plugin: string) => boolean;
  autoUpdate?: () => boolean;
  rollbackClone?: (homeDir: string, plugin: string, appId: string) => void | Promise<void>;
}

export interface Runner {
  enqueue(spec: JobSpec): Job;
  list(): Job[];
  cancel(id: string): boolean;
  clearFinished(): void;
}

// The worker is emitted as a SIBLING of the sidecar bundle this code is inlined into
// (out/main/sidecar.js and out/main/installer.js), so it resolves against this module's own
// directory. The override exists because running from source puts this file a few dirs deeper.
export const INSTALLER_PATH_ENV = "FOREBAY_INSTALLER_PATH";

function workerPath(): string {
  const override = process.env[INSTALLER_PATH_ENV];
  return override && override.trim() ? override : join(fileURLToPath(new URL(".", import.meta.url)), "installer.js");
}

// Killing the worker alone leaves the git and npm processes it spawned running, and on
// Windows those keep a handle on the clone that the rollback then cannot delete.
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => { /* already gone is fine */ });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
}

// Electron's process.execPath is Electron, not node, and a forked child inherits the parent's
// execArgv. Both have to be stated or the worker never boots in the packaged app.
function realSpawn(_job: Job, message: JobMessage): WorkerHandle {
  const child = fork(workerPath(), {
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env, ...activityEnv(), ELECTRON_RUN_AS_NODE: "1", CORE_APP: message.home,
      // Ask git to stream its progress so the transfer can be reported as it happens, and
      // ask the manager to mirror its log to stderr so its own stages are readable too.
      PLUGIN_UPDATER_GIT_PROGRESS: "1",
      CORE_LOG_CONSOLE: "1",
    },
  });
  // Nobody reads stdout, so a chatty child would eventually wedge on a full buffer.
  child.stdout?.resume();
  child.send(message);
  return {
    onMessage: (fn) => child.on("message", fn),
    onStderr: (fn) => {
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => fn(chunk));
    },
    onExit: (fn) => child.on("exit", (code) => fn(code)),
    kill: () => killTree(child.pid),
  };
}

// A killed worker's git or npm child can outlive it by a moment and keep the clone locked,
// so a delete that fails on a lock is retried rather than reported as a dirty home.
const ROLLBACK_ATTEMPTS = 12;
const ROLLBACK_WAIT_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function removeWithRetry(path: string, wait: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      if (attempt >= ROLLBACK_ATTEMPTS) throw error;
      await wait(ROLLBACK_WAIT_MS);
    }
  }
}

// A fresh install can be cancelled before it was ever registered, so removing the entry is
// conditional: a manager's remove reports a failure when there is nothing registered, and it is
// what prunes the clone and the deployed bundle when there is.
async function realRollbackClone(homeDir: string, plugin: string, appId: string, wait: (ms: number) => Promise<void>): Promise<void> {
  if ((await listedPlugins(homeDir, appId)).some((entry) => entry.id === plugin)) {
    await invokePluginManagement(homeDir, appId, "remove", null, (capability) => capability.remove(plugin));
  }
  for (const path of [join(reposDir(homeDir), plugin), join(pluginDir(homeDir), `${plugin}.js`), join(pluginDir(homeDir), `${plugin}.sha`)]) {
    await removeWithRetry(path, wait);
  }
}

export function createRunner(deps: RunnerDeps = {}): Runner {
  const spawnWorker = deps.spawnWorker ?? realSpawn;
  const now = deps.now ?? (() => Date.now());
  const onChange = deps.onChange ?? (() => {});
  const resolveHome = deps.resolveHome ?? ((homeId: string) => ({ dir: homeId }));
  const isPluginManager = deps.isPluginManager ?? (() => false);
  const autoUpdate = deps.autoUpdate ?? (() => true);
  const wait = deps.wait ?? sleep;
  const rollbackClone = deps.rollbackClone ?? ((dir: string, plugin: string, appId: string) => realRollbackClone(dir, plugin, appId, wait));

  let counter = 0;
  const newId = deps.newId ?? (() => `job-${++counter}-${now().toString(36)}`);

  const jobs: Job[] = [];
  let active: { id: string; worker: WorkerHandle; rollback: Rollback } | null = null;

  function replace(job: Job): void {
    const index = jobs.findIndex((j) => j.id === job.id);
    if (index >= 0) jobs[index] = job;
    onChange(job);
  }

  function get(id: string): Job | undefined {
    return jobs.find((j) => j.id === id);
  }

  function end(id: string, status: Job["status"], error?: string): void {
    const job = get(id);
    if (!job || isEnded(job)) return;
    replace({ ...job, status, endedAt: now(), error: error ?? job.error });
    if (active?.id === id) active = null;
    drain();
  }

  function drain(): void {
    const next = nextRunnable(jobs);
    if (!next) return;
    const started: Job = { ...next, status: "running", startedAt: now() };
    replace(started);
    const message: JobMessage = {
      jobId: started.id,
      kind: started.kind,
      plugin: started.plugin,
      url: started.url,
      home: started.home,
      homeDir: resolveHome(started.home).dir,
      isPluginManager: isPluginManager(started.plugin),
      autoUpdate: autoUpdate(),
    };
    const worker = spawnWorker(started, message);
    active = { id: started.id, worker, rollback: "none" };

    worker.onMessage((raw) => {
      const message = raw as { jobId?: string; phase?: string; percent?: number; done?: boolean; error?: string };
      if (message.jobId !== started.id) return;
      const job = get(started.id);
      if (!job || isEnded(job) || job.status === "cancelling") return;
      if (typeof message.phase === "string") {
        replace(applyEvent(job, { phase: message.phase, percent: message.percent ?? -1 }, now()));
        return;
      }
      if (message.error) { end(started.id, "failed", message.error); return; }
      if (message.done) end(started.id, "done");
    });

    worker.onStderr?.((chunk) => {
      const job = get(started.id);
      if (!job || isEnded(job) || job.status === "cancelling") return;
      const transfer = parseGitProgress(chunk);
      if (transfer) {
        replace(noteTransfer(job, transfer, now()));
        return;
      }
      // No transfer in this chunk, but the manager may have said which stage it reached.
      const stage = parseWorkerPhase(chunk, job.kind);
      if (stage) replace(applyEvent(job, { phase: stage.phase, percent: stage.percent }, now()));
    });

    worker.onExit((code) => {
      const job = get(started.id);
      if (!job || isEnded(job)) return;
      if (job.status !== "cancelling") {
        end(started.id, "failed", `the installer exited with code ${code}`);
        return;
      }
      const needsRollback = active?.rollback === "remove-clone";
      return Promise.resolve()
        .then(() => (needsRollback ? rollbackClone(message.homeDir, started.plugin, message.home) : undefined))
        .then(
          () => end(started.id, "cancelled"),
          (e: unknown) => end(started.id, "cancelled", `rollback failed: ${e instanceof Error ? e.message : String(e)}`),
        );
    });
  }

  return {
    enqueue(spec) {
      const job = newJob(newId(), spec, now());
      jobs.push(job);
      onChange(job);
      drain();
      return get(job.id) ?? job;
    },
    list() {
      return jobs.map((job) => ({ ...job }));
    },
    cancel(id) {
      const job = get(id);
      if (!job) return false;
      const { job: cancelled, rollback } = cancelJob(job, now());
      if (cancelled.status === job.status && rollback === "none") return false;
      replace(cancelled);
      if (cancelled.status === "cancelled") { drain(); return true; }
      if (active?.id === id) {
        active = { ...active, rollback };
        active.worker.kill();
      }
      return true;
    },
    clearFinished() {
      for (let i = jobs.length - 1; i >= 0; i--) if (isEnded(jobs[i])) jobs.splice(i, 1);
    },
  };
}
