import { writable, derived, get } from "svelte/store";
import type { Job, JobKind, JobPhase, JobSample, Result } from "@forebay/shared";
import { forebay } from "./ipc.js";
import { invalidate } from "./cache.js";
import { humanizeId } from "./util/appLabel.js";

// The panel shows two kinds of work. Plugin jobs belong to the sidecar, which owns the queue
// so a cancel and a per-home status survive a reload; everything else (an app CLI install, an
// import, a removal) is a local promise this module tracks itself. Both render as one list.

export type DownloadStatus = "pending" | "installing" | "cancelling" | "done" | "failed" | "cancelled";

export type DownloadRow = {
  id: string;
  label: string;
  home: string;
  status: DownloadStatus;
  step: string;
  // Coarse phase-based progress 0..100; -1 means indeterminate.
  percent: number;
  error: string;
  // Set for plugin work: `<plugin>` and `<plugin>:<home>` lookups are built from it.
  plugin?: string;
  homeId?: string;
  jobId?: string;
  phases: JobPhase[];
  // Real transfer figures, absent for work that transfers nothing.
  bytes?: number;
  bytesPerSecond?: number;
  samples: JobSample[];
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  cancellable: boolean;
};

type LocalTask = {
  id: number;
  label: string;
  home: string;
  status: DownloadStatus;
  step: string;
  percent: number;
  error: string;
  queuedAt: number;
  startedAt: number;
  endedAt?: number;
};

const jobs = writable<Job[]>([]);
const localTasks = writable<LocalTask[]>([]);
export const panelOpen = writable(false);

const JOB_STATUS: Record<Job["status"], DownloadStatus> = {
  queued: "pending",
  running: "installing",
  cancelling: "cancelling",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

const VERB: Record<JobKind, string> = { install: "Install", update: "Update", remove: "Remove", repair: "Repair" };

function jobRow(job: Job): DownloadRow {
  return {
    id: `job:${job.id}`,
    label: `${VERB[job.kind]} ${job.plugin}`,
    home: humanizeId(job.home),
    status: JOB_STATUS[job.status],
    step: job.phase,
    percent: job.percent,
    error: job.error ?? "",
    plugin: job.plugin,
    homeId: job.home,
    jobId: job.id,
    phases: job.phases ?? [],
    bytes: job.bytes,
    bytesPerSecond: job.bytesPerSecond,
    samples: job.samples ?? [],
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    cancellable: job.status === "queued" || job.status === "running",
  };
}

function localRow(task: LocalTask): DownloadRow {
  return { ...task, id: `task:${task.id}`, phases: [], samples: [], cancellable: false };
}

export const rows = derived([jobs, localTasks], ([$jobs, $local]) =>
  [...$jobs.map(jobRow), ...$local.map(localRow)].sort((a, b) => a.queuedAt - b.queuedAt),
);

// Kept for the existing panel, which reads { tasks, open }.
export const downloads = derived([rows, panelOpen], ([$rows, $open]) => ({ tasks: $rows, open: $open }));

const LIVE: DownloadStatus[] = ["pending", "installing", "cancelling"];

function isLive(row: DownloadRow): boolean {
  return LIVE.includes(row.status);
}

// Any live work for a plugin, whichever home it targets: what a plugin-level button needs.
export const activeByPlugin = derived(rows, ($rows) => {
  const map: Record<string, DownloadRow> = {};
  for (const row of $rows) if (row.plugin && isLive(row) && !map[row.plugin]) map[row.plugin] = row;
  return map;
});

// Live work for one plugin in ONE home: what an Availability row needs to say "queued here,
// installing there". Keying by plugin alone cannot express that.
export const activeByPluginHome = derived(rows, ($rows) => {
  const map: Record<string, DownloadRow> = {};
  for (const row of $rows) if (row.plugin && row.homeId && isLive(row)) map[`${row.plugin}:${row.homeId}`] = row;
  return map;
});

export function jobKey(plugin: string, homeId: string): string {
  return `${plugin}:${homeId}`;
}

// Mirror the sidecar's list: the snapshot covers a renderer that started mid-job, the
// subscription covers everything after.
export function watchJobs(): () => void {
  void forebay.jobsList().then((result) => {
    if (result.ok) jobs.set(result.data);
  });
  return forebay.onJobEvent((job) => {
    // A job installs, updates or removes a plugin in a home, so anything the read cache holds
    // about plugins is stale the moment it ends. The renderer only learns this from the event:
    // the change happened in the sidecar, behind no call of its own. Cleared before the store
    // notifies, so a caller waiting on jobSettled resumes against an empty cache.
    if (!LIVE.includes(JOB_STATUS[job.status])) invalidate();
    jobs.update((list) => {
      const index = list.findIndex((j) => j.id === job.id);
      if (index < 0) return [...list, job];
      const next = list.slice();
      next[index] = job;
      return next;
    });
  });
}

export async function enqueueJob(kind: JobKind, plugin: string, url: string, homeId: string): Promise<Result<Job>> {
  panelOpen.set(true);
  const result = await forebay.jobsEnqueue(kind, plugin, url, homeId);
  if (result.ok) {
    jobs.update((list) => (list.some((j) => j.id === result.data.id) ? list : [...list, result.data]));
  }
  return result;
}

export function cancelRow(row: DownloadRow): void {
  if (row.jobId) void forebay.jobsCancel(row.jobId);
}

// Waits for the plugin's own work to finish, so a caller can reload once it is really done.
export function jobSettled(jobId: string): Promise<DownloadRow | undefined> {
  return new Promise((resolve) => {
    const stop = rows.subscribe(($rows) => {
      const row = $rows.find((r) => r.jobId === jobId);
      if (row && !isLive(row)) {
        setTimeout(() => stop(), 0);
        resolve(row);
      }
    });
  });
}

let nextLocalId = 1;

export type EnqueueSpec<T> = {
  label: string;
  home: string;
  run: (id: number) => Promise<Result<T>>;
  // Flags a partial failure a plain ok/error Result cannot express, e.g. a multi-home
  // operation where the call succeeded but some homes failed.
  summarizeFailure?: (data: T) => string | null;
};

function patchLocal(id: number, partial: Partial<LocalTask>): void {
  localTasks.update((list) => list.map((task) => (task.id === id ? { ...task, ...partial } : task)));
}

// Without an end time a finished task's elapsed clock keeps counting up from when it started.
function settleLocal(id: number, partial: Partial<LocalTask>): void {
  patchLocal(id, { ...partial, endedAt: Date.now() });
}

// A local operation with no sidecar job behind it. Runs immediately: the sidecar queue exists
// to serialize plugin builds, and these are not that.
export function enqueue<T>(spec: EnqueueSpec<T>): Promise<Result<T>> {
  const id = nextLocalId++;
  const at = Date.now();
  localTasks.update((list) => [
    ...list,
    { id, label: spec.label, home: spec.home, status: "installing", step: "", percent: -1, error: "", queuedAt: at, startedAt: at },
  ]);
  panelOpen.set(true);

  return spec.run(id).then(
    (result) => {
      if (result.ok) {
        const failure = spec.summarizeFailure?.(result.data) ?? null;
        settleLocal(id, failure ? { status: "failed", error: failure } : { status: "done" });
      } else {
        settleLocal(id, { status: "failed", error: result.error });
      }
      return result;
    },
    (thrown: unknown) => {
      const error = thrown instanceof Error ? thrown.message : String(thrown);
      settleLocal(id, { status: "failed", error });
      return { ok: false, error } as Result<T>;
    },
  );
}

export function track<T>(
  label: string,
  home: string,
  run: () => Promise<Result<T>>,
  summarizeFailure?: (data: T) => string | null,
): Promise<Result<T>> {
  return enqueue({ label, home, run, summarizeFailure });
}

// Applied from a pushed progress event; only meaningful while the task is still in flight.
export function setStep(id: number, step: string, percent = -1): void {
  localTasks.update((list) =>
    list.map((task) => (task.id === id && isLive(localRow(task)) ? { ...task, step, percent } : task)),
  );
}

export function toggleDownloads(): void {
  panelOpen.update((open) => !open);
}

export function closeDownloads(): void {
  panelOpen.set(false);
}

export function clearFinished(): void {
  localTasks.update((list) => list.filter((task) => isLive(localRow(task))));
  if (get(jobs).some((job) => !LIVE.includes(JOB_STATUS[job.status]))) void forebay.jobsClearFinished();
  jobs.update((list) => list.filter((job) => LIVE.includes(JOB_STATUS[job.status])));
}

// Tests share this module's state; clear it between cases. Not used by the app.
export function resetDownloadsForTest(): void {
  nextLocalId = 1;
  jobs.set([]);
  localTasks.set([]);
  panelOpen.set(false);
}

// Seeders so a component test can render a given queue without a sidecar behind it.
export function seedJobsForTest(list: Job[]): void {
  jobs.set(list);
}

export function seedTasksForTest(list: Array<Partial<LocalTask>>): void {
  localTasks.set(list.map((task, index) => ({
    id: index + 1, label: "task", home: "/h", status: "installing", step: "", percent: -1, error: "",
    queuedAt: index, startedAt: index,
    ...task,
  })));
}

export function openPanelForTest(): void {
  panelOpen.set(true);
}
