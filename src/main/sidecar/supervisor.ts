import { createRequire } from "node:module";
import type { UtilityProcess } from "electron";
import type { Result, DownloadProgress, Job } from "@forebay/shared";
import { err } from "../../sidecar/result.js";

// Loaded lazily inside createSupervisor: requiring "electron" at module top
// level throws outside a real Electron process, and this module is imported
// by the buildSidecarEnv unit test under plain Node/vitest.
const require = createRequire(import.meta.url);

export function buildSidecarEnv(base: NodeJS.ProcessEnv, storeDir: string): NodeJS.ProcessEnv {
  return { ...base, HUB_CONFIG_DIR: storeDir };
}

export function computeBackoffMs(attempt: number): number {
  return Math.min(200 * 2 ** attempt, 5000);
}

export function shouldGiveUp(attempt: number, cap = 5): boolean {
  return attempt >= cap;
}

type SidecarResponse = { id: number; result: Result<unknown> };
type SidecarMessage = { id?: number; result?: Result<unknown>; progress?: DownloadProgress; job?: Job };

export interface SupervisorOptions {
  sidecarPath: string;
  storeDir: string;
  rpcTimeoutMs?: number;
  restartCap?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onJob?: (job: Job) => void;
}

export interface Supervisor {
  rpc(channel: string, args: unknown[], timeoutMs?: number): Promise<Result<unknown>>;
  dispose(): void;
}

interface PendingEntry {
  resolve: (result: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createSupervisor(opts: SupervisorOptions): Supervisor {
  const { utilityProcess } = require("electron") as typeof import("electron");

  const rpcTimeoutMs = opts.rpcTimeoutMs ?? 15000;
  const restartCap = opts.restartCap ?? 5;

  let nextId = 1;
  let disposing = false;
  let failed = false;
  let restartAttempt = 0;
  const pending = new Map<number, PendingEntry>();

  function settle(id: number, result: Result<unknown>): void {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(result);
  }

  function handleMessage(message: unknown): void {
    const msg = message as SidecarMessage;
    if (msg.job) {
      opts.onJob?.(msg.job);
      return;
    }
    if (msg.progress) {
      opts.onProgress?.(msg.progress);
      return;
    }
    restartAttempt = 0;
    settle(msg.id as number, msg.result as Result<unknown>);
  }

  function handleExit(): void {
    for (const id of [...pending.keys()]) settle(id, err("sidecar process exited"));
    if (disposing) return;
    if (shouldGiveUp(restartAttempt, restartCap)) {
      failed = true;
      return;
    }
    const delay = computeBackoffMs(restartAttempt);
    restartAttempt++;
    setTimeout(() => {
      if (!disposing) child = spawn();
    }, delay);
  }

  function spawn(): UtilityProcess {
    const proc = utilityProcess.fork(opts.sidecarPath, [], {
      env: buildSidecarEnv(process.env, opts.storeDir),
      stdio: "pipe",
    });
    // Piped stdio must be consumed: an unread pipe eventually blocks the
    // child, and without these logs a sidecar crash is undiagnosable.
    proc.stdout?.on("data", (chunk) => console.log("[sidecar]", String(chunk).trimEnd()));
    proc.stderr?.on("data", (chunk) => console.error("[sidecar]", String(chunk).trimEnd()));
    proc.on("message", handleMessage);
    proc.on("exit", onExit);
    return proc;
  }

  function onExit(code: number): void {
    if (code !== 0) console.error(`[sidecar] exited with code ${code}`);
    handleExit();
  }

  function rpc(channel: string, args: unknown[], timeoutMs?: number): Promise<Result<unknown>> {
    if (failed) return Promise.resolve(err("sidecar failed to stay up"));
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        settle(id, err("sidecar rpc timeout: " + channel));
      }, timeoutMs ?? rpcTimeoutMs);
      pending.set(id, { resolve, timer });
      child.postMessage({ id, channel, args });
    });
  }

  let child = spawn();

  return {
    rpc,
    dispose() {
      disposing = true;
      for (const id of [...pending.keys()]) settle(id, err("sidecar disposed"));
      child.off("exit", onExit);
      // A hung or already-dead sidecar must never keep the app open, so the shutdown
      // request carries its own short deadline; rpc() always resolves by then, never rejects.
      void rpc("shutdown", [], 1000).finally(() => { child.kill(); });
    },
  };
}
