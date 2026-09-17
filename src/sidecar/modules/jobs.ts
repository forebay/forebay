import { getConfigValue } from "@intisy-ai/basekit";
import { createRunner } from "../jobs/runner.js";
import type { Job, JobKind, JobSpec } from "../jobs/model.js";
import { pluginHomes } from "../lib/pluginHomes.js";
import { pluginOwningCapability } from "./engines.js";
import { repoProvidingCapability } from "../lib/capabilityCatalog.js";
import type { PluginHome, Result } from "../../../packages/shared/src/domain.js";
import { wrap } from "../result.js";

const PLUGIN_MANAGEMENT = "plugin-management";

// The runner resolves a home to a directory synchronously, while listing homes is async, so
// each enqueue refreshes this map first. A job already in flight keeps the dir it started with.
const homeDirs: Record<string, string> = {};

// The manager's id, once resolved from what a marketplace DECLARES for plugin-management. Not
// what a home has already deployed: the bootstrap install of the manager itself runs before
// anything is deployed anywhere, so a deployed-only lookup would never recognize it.
let managerId: string | null = null;

let notify: (job: Job) => void = () => {};

export function setJobListener(listener: (job: Job) => void): void {
  notify = listener;
}

function autoUpdateDefault(): boolean {
  const value = getConfigValue("forebay", "autoUpdateDefault");
  return typeof value === "boolean" ? value : true;
}

const runner = createRunner({
  onChange: (job) => notify(job),
  resolveHome: (homeId) => ({ dir: homeDirs[homeId] ?? homeId }),
  isPluginManager: (plugin) => plugin === managerId
    || Object.values(homeDirs).some((dir) => pluginOwningCapability(PLUGIN_MANAGEMENT, dir) === plugin),
  autoUpdate: autoUpdateDefault,
});

export function jobsList(): Promise<Result<Job[]>> {
  return wrap(() => runner.list());
}

export function jobsEnqueue(kind: JobKind, plugin: string, url: string, home: string, deps: { homes?: PluginHome[] } = {}): Promise<Result<Job>> {
  return wrap(async () => {
    const homes = deps.homes ?? (await pluginHomes());
    for (const entry of homes) homeDirs[entry.id] = entry.dir;
    if (!homeDirs[home]) throw new Error(`unknown plugin home: ${home}`);
    managerId ??= (await repoProvidingCapability(homeDirs[home] ?? "", PLUGIN_MANAGEMENT))?.id ?? null;
    const spec: JobSpec = { kind, plugin, url, home };
    return runner.enqueue(spec);
  });
}

export function jobsCancel(id: string): Promise<Result<boolean>> {
  return wrap(() => runner.cancel(id));
}

export function jobsClearFinished(): Promise<Result<void>> {
  return wrap(() => runner.clearFinished());
}
