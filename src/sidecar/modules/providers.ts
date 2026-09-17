import { readDeployedProviders } from "@intisy-ai/basekit/loader/loader-runtime.js";
import { listAccounts, getConfigDir } from "@intisy-ai/basekit/auth";
import { getApps } from "@intisy-ai/basekit";
import { PROVIDER } from "@intisy-ai/basekit/auth";
import type { Provider, ProviderDescriptor } from "@intisy-ai/basekit/auth";
import { capabilityProviders, callHostCapability, DEFAULT_CALL_TIMEOUT_MS } from "../lib/pluginHost.js";
import { pluginIdFromClone } from "../lib/capabilityOwner.js";
import { reposDir } from "../lib/storagePaths.js";
import { exposureFor, readExposureMap, setExposure } from "../lib/exposure.js";
import { readPluginManifest, providerIcon } from "../lib/pluginManifest.js";
import type { ProviderRow, Result } from "../../../packages/shared/src/domain.js";
import { wrap } from "../result.js";
import { emitForebayAction } from "../activity.js";

/** One lane as the deployed inventory describes it, before any capability has spoken for it. */
interface DeployedLane {
  provider: string;
  repo: string;
  handler: string;
  handlerPath: string;
  translator: string | undefined;
  accountPool: string;
  models: unknown[];
}

/** One lane as its plugin's `provider` capability describes it. */
// Both shapes are basekit/auth's, taken rather than restated. The local `LaneDescriptor` was a
// ProviderDescriptor with `models` dropped, which reads as a lane having none rather than as this
// module not using them.
type LaneDescriptor = ProviderDescriptor;
type ProviderCapabilityLike = Pick<Provider, "id" | "providers">;

export interface ProvidersDeps {
  homeDir?: string;
  appId?: string;
  deployed?: (homeDir: string) => DeployedLane[];
  accountsFor?: (pool: string) => unknown[];
  exposure?: () => Record<string, Record<string, boolean>>;
  manifestFor?: (plugin: string, homeDir: string) => ReturnType<typeof readPluginManifest>;
  pluginIdFor?: (repo: string, homeDir: string) => string;
}

// One capability call per providing plugin, not per lane: a plugin backing several lanes off one
// account pool answers for all of them at once, and calling per lane would import and question the
// same plugin repeatedly.
async function describedLanes(
  homeDir: string,
  appId: string,
): Promise<{ byId: Map<string, LaneDescriptor>; errorFor: Map<string, string> }> {
  const byId = new Map<string, LaneDescriptor>();
  const errorFor = new Map<string, string>();
  for (const record of await capabilityProviders(homeDir, appId, PROVIDER.id)) {
    const capability = record.implementation as ProviderCapabilityLike;
    if (typeof capability?.providers !== "function") continue;
    const answer = await callHostCapability(record.pluginId, "provider.providers", DEFAULT_CALL_TIMEOUT_MS, async () => capability.providers!());
    if (answer.ok === false) {
      errorFor.set(record.pluginId, answer.error.detail);
      continue;
    }
    for (const lane of Array.isArray(answer.value) ? answer.value : []) {
      if (lane && typeof lane.id === "string") byId.set(lane.id, lane);
    }
  }
  return { byId, errorFor };
}

export function providersList(deps: ProvidersDeps = {}): Promise<Result<ProviderRow[]>> {
  return wrap(async () => {
    const homeDir = deps.homeDir ?? getConfigDir();
    const appId = deps.appId ?? "forebay";
    const deployed = (deps.deployed ?? ((dir: string) => readDeployedProviders(reposDir(dir), dir) as DeployedLane[]))(homeDir);
    const exposureMap = (deps.exposure ?? readExposureMap)();
    const accountsFor = deps.accountsFor ?? ((pool: string) => listAccounts(pool, undefined));
    const readManifest = deps.manifestFor ?? readPluginManifest;
    const resolvePluginId = deps.pluginIdFor ?? pluginIdFromClone;
    const { byId, errorFor } = await describedLanes(homeDir, appId);

    // One manifest read per deploying plugin, not per lane: a plugin deploying several lanes would
    // otherwise re-read and re-encode the same icons for each of them.
    const manifests = new Map<string, ReturnType<typeof readPluginManifest>>();
    function manifestFor(plugin: string): ReturnType<typeof readPluginManifest> {
      let cached = manifests.get(plugin);
      if (!cached) {
        cached = readManifest(plugin, homeDir);
        manifests.set(plugin, cached);
      }
      return cached;
    }

    // One plugin.json read per deploying clone, not per lane, for the same reason as manifestFor.
    const pluginIds = new Map<string, string>();
    function pluginIdFor(repo: string): string {
      let cached = pluginIds.get(repo);
      if (cached === undefined) {
        cached = resolvePluginId(repo, homeDir);
        pluginIds.set(repo, cached);
      }
      return cached;
    }

    const rows: ProviderRow[] = [];
    for (const lane of deployed) {
      const described = byId.get(lane.provider);
      const accountPool = described?.accountPool ?? lane.accountPool;
      const exposure = exposureFor(exposureMap, lane.provider);
      const row: ProviderRow = {
        id: lane.provider,
        label: described?.label ?? lane.provider,
        authKind: described?.hasOAuth ? "oauth" : "api-key",
        accountCount: accountsFor(accountPool).length,
        enabled: Object.values(exposure).some(Boolean),
        exposure,
        translator: lane.translator ?? described?.translator,
        accountPool,
        sharedWith: [],
        pluginName: lane.repo,
        icon: providerIcon(manifestFor(lane.repo), lane.provider),
      };
      const failure = errorFor.get(pluginIdFor(lane.repo));
      if (failure) row.defsError = failure;
      rows.push(row);
    }

    // sharedWith is computed across the full list, not per lane: two providers (from the same or
    // different plugins) that declare the same accountPool cross-link each other here.
    const idsByPool = new Map<string, string[]>();
    for (const row of rows) {
      const ids = idsByPool.get(row.accountPool) ?? [];
      ids.push(row.id);
      idsByPool.set(row.accountPool, ids);
    }
    for (const row of rows) {
      row.sharedWith = (idsByPool.get(row.accountPool) ?? []).filter((id) => id !== row.id);
    }

    return rows;
  });
}

export function providersSetEnabled(id: string, on: boolean): Promise<Result<void>> {
  return wrap(async () => {
    for (const app of getApps()) setExposure(id, app.id, on);
    await emitForebayAction({
      action: on ? "provider_enabled" : "provider_disabled",
      subject: { kind: "provider", id, label: id },
      topic: "provider.state",
      details: { message: `${on ? "Enabled" : "Disabled"} ${id} everywhere` },
    });
  });
}

export function providersSetExposure(id: string, appId: string, on: boolean): Promise<Result<void>> {
  return wrap(async () => {
    setExposure(id, appId, on);
    await emitForebayAction({
      action: "provider_exposure_changed",
      subject: { kind: "provider", id, label: id },
      topic: "provider.state",
      homeId: appId,
      details: { exposed: on, message: `${id} ${on ? "exposed to" : "hidden from"} ${appId}` },
    });
  });
}
