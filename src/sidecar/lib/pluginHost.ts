import { setDiagnosticSink } from "@intisy/bayonet/engine";
import { createPluginRuntime } from "@intisy-ai/basekit";
import { PROVIDER_SUPPORT, providerSupport } from "@intisy-ai/basekit/auth";
import {
  callCapability,
  ledgerRows,
  startPlugins,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_INVOKE_TIMEOUT_MS,
} from "@intisy/bayonet/host";
import type { LoadedHost, PluginHostOptions, PluginLedgerRow } from "@intisy/bayonet/host";
import { pluginDir } from "./storagePaths.js";

export { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS };
export type { PluginLedgerRow };

// A plugin bundle activates itself on import unless the process says it is a library being loaded
// by a host. Both vocabularies are set because a plugin deployed before the rename reads only the
// vendor-named pair. This runs at module load, before any dynamic import can reach a bundle.
process.env.INTISY_PLUGIN_LIBRARY_MODE = "1";
process.env.PLUGIN_UPDATER_LIBRARY_MODE = "1";
process.env.INTISY_PLUGIN_ACTIVATION = "0";
process.env.PLUGIN_UPDATER_ACTIVATION = "0";

// The supervisor merely logs a forked child's stdout rather than treating it as a channel, so an
// ignored-unknown report written there would be silent noise; stderr is where the supervisor's own
// log actually surfaces it.
setDiagnosticSink((message: string) => { process.stderr.write("[plugin-api] " + message + "\n"); });

export interface PluginHostDeps {
  start?: (options: PluginHostOptions) => Promise<LoadedHost>;
}

export interface CapabilityRecord {
  pluginId: string;
  implementation: unknown;
}

export interface QuarantineRecord {
  pluginId: string;
  detail: string;
  fix: string;
}

const hosts = new Map<string, Promise<LoadedHost | null>>();

/**
 * The running host for one plugin home, started on first ask and cached afterwards.
 *
 * @remarks
 * Null rather than a throw when a home cannot be hosted: Forebay renders several homes side by side
 * and one unreadable home must cost its own capabilities, never the others'. A rejected start is
 * cached as null for the life of the sidecar, which matches how the rest of the dashboard treats a
 * home it could not read.
 */
export function hostFor(homeDir: string, appId: string, deps: PluginHostDeps = {}): Promise<LoadedHost | null> {
  const existing = hosts.get(homeDir);
  if (existing) return existing;
  const start = deps.start ?? startPlugins;
  const loading = start({
    app: appId,
    pluginDir: pluginDir(homeDir),
    surfaces: [SURFACE],
    // Behaviour a plugin may not link for itself: basekit/auth's provider helpers, linked once here
    // rather than copied into every provider bundle.
    services: [{ id: PROVIDER_SUPPORT, implementation: providerSupport() }],
    runtimeFor: (manifest) => createPluginRuntime(manifest.id, homeDir),
  }).catch((error: unknown) => {
    process.stderr.write(`[plugin-api] host for ${homeDir} failed to start: ${String(error)}\n`);
    return null;
  });
  hosts.set(homeDir, loading);
  return loading;
}

/**
 * The surface id this dashboard renders as.
 *
 * @remarks
 * Named once because it is asserted twice: the host is told which surface it is driving, and a
 * screen's per-surface layout override is resolved against the same id. Two literals would let a
 * plugin's override for this surface go unrendered.
 */
export const SURFACE = "forebay";

/** Every plugin providing a capability in one home, in activation order. */
export async function capabilityProviders(
  homeDir: string,
  appId: string,
  capabilityId: string,
  deps: PluginHostDeps = {},
): Promise<CapabilityRecord[]> {
  const loaded = await hostFor(homeDir, appId, deps);
  if (!loaded) return [];
  return loaded.host.capability(capabilityId).map((record) => ({ pluginId: record.pluginId, implementation: record.implementation }));
}

/** One plugin's implementation of a capability in one home, or undefined when it provides none. */
export async function capabilityOfPlugin(
  homeDir: string,
  appId: string,
  pluginId: string,
  capabilityId: string,
  deps: PluginHostDeps = {},
): Promise<unknown> {
  const providers = await capabilityProviders(homeDir, appId, capabilityId, deps);
  return providers.find((record) => record.pluginId === pluginId)?.implementation;
}

/** A bounded call into a plugin. Never throws; a failure is data, and never a quarantine. */
export const callHostCapability = callCapability;

/** Every plugin's relationship record for one home. */
export async function ledgerFor(homeDir: string, appId: string, deps: PluginHostDeps = {}): Promise<PluginLedgerRow[]> {
  const loaded = await hostFor(homeDir, appId, deps);
  return loaded ? ledgerRows(loaded) : [];
}

/** Every plugin this home refused to load, with the reason and the fix. */
export async function quarantinedIn(homeDir: string, appId: string, deps: PluginHostDeps = {}): Promise<QuarantineRecord[]> {
  const loaded = await hostFor(homeDir, appId, deps);
  if (!loaded) return [];
  return loaded.quarantined.map((error) => ({ pluginId: error.pluginId, detail: error.detail, fix: error.fix }));
}

/** Deactivates every started plugin in every home. */
export async function stopAllHosts(): Promise<void> {
  const running = [...hosts.values()];
  hosts.clear();
  for (const pending of running) {
    const loaded = await pending;
    if (loaded) await loaded.stop().catch(() => undefined);
  }
}

export function resetPluginHostsForTests(): void {
  hosts.clear();
}
