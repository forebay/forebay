// Runs ONE plugin job, in its own process, then exits. A manager does its git, npm and deploy
// work synchronously, so running it anywhere else would stop the sidecar answering.
import { getAppDescriptor, registerPluginWithApp } from "@intisy-ai/basekit";
import type { ActionResult, PluginManagementCapability } from "@intisy-ai/basekit";
import { invokePluginManagement } from "../sidecar/lib/pluginManager.js";
import { installPluginRepo } from "../sidecar/lib/pluginBootstrap.js";

export interface JobMessage {
  jobId: string;
  kind: "install" | "update" | "remove" | "repair";
  plugin: string;
  url: string;
  home: string;
  homeDir: string;
  isPluginManager: boolean;
  autoUpdate: boolean;
}

function report(jobId: string, phase: string, percent: number): void {
  process.send?.({ jobId, phase, percent });
}

function managed(job: JobMessage, operation: string, work: (capability: PluginManagementCapability) => Promise<ActionResult>): Promise<ActionResult | null> {
  return invokePluginManagement(job.homeDir, job.home, operation, null, work);
}

function refused(job: JobMessage, operation: string, outcome: ActionResult | null): never | void {
  if (!outcome) throw new Error(`nothing manages the plugins of ${job.home}`);
  if (!outcome.ok) throw new Error(outcome.message || `could not ${operation} ${job.plugin}`);
}

async function run(job: JobMessage): Promise<void> {
  if (job.kind === "remove") {
    report(job.jobId, "removing", 25);
    refused(job, "remove", await managed(job, "remove", (capability) => capability.remove(job.plugin)));
    report(job.jobId, "removed", 90);
    return;
  }

  // A repair rebuilds what is already cloned, so it skips git entirely: the commit is not what is
  // wrong, the build output is.
  if (job.kind === "repair") {
    report(job.jobId, "rebuilding", 20);
    refused(job, "repair", await managed(job, "repair", (capability) => capability.repair(job.plugin)));
    report(job.jobId, "rebuilt", 90);
    return;
  }

  if (job.kind === "update") {
    report(job.jobId, "downloading", 10);
    refused(job, "update", await managed(job, "update", (capability) => capability.update(job.plugin)));
  } else {
    await installPluginRepo(job.homeDir, job.plugin, job.url, job.home,
      (step, percent) => report(job.jobId, step.toLowerCase(), percent));
    if (!job.autoUpdate) {
      await managed(job, "setAutoUpdate", (capability) => capability.setAutoUpdate(job.plugin, false));
    }
  }

  // An app loads the manager through its own config, so a clone alone would leave a manager that
  // is installed but never runs.
  if (job.isPluginManager && job.home !== "forebay") {
    report(job.jobId, "registering with the app", 90);
    registerPluginWithApp(job.homeDir, getAppDescriptor(job.home) ?? null, job.plugin);
  }
}

process.on("message", (raw: unknown) => {
  const job = raw as JobMessage;
  run(job)
    .then(() => {
      process.send?.({ jobId: job.jobId, done: true });
      process.exit(0);
    })
    .catch((error: unknown) => {
      process.send?.({ jobId: job.jobId, error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
});
