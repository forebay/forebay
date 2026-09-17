import { homedir } from "node:os";
import { startLoaderProxy } from "@intisy-ai/basekit/loader/proxy-runner.js";
import type { StartLoaderProxyOptions, StartedLoaderProxy } from "@intisy-ai/basekit/loader/proxy-runner.js";
import { createProxyServer, makeDynamicResolver } from "@intisy-ai/basekit/proxy";
import type { RoutingProfile } from "@intisy-ai/basekit/proxy";
import { loadInstalledProxyDefs, unresolvedProxyPlugins } from "../../sidecar/lib/proxyPlugins.js";
import type { LoadedProxyDef } from "../../sidecar/lib/proxyPlugins.js";
import type { ProxyStatus } from "../../../packages/shared/src/domain.js";
import { resolveLocalApiPort } from "../../sidecar/lib/localApiPort.js";
import { resolveStoreDir } from "../lib/storeDir.js";

type Starter = (options: StartLoaderProxyOptions<RoutingProfile>) => Promise<StartedLoaderProxy>;

let handle: StartedLoaderProxy | null = null;
let startingPromise: Promise<void> | null = null;
let stoppingPromise: Promise<void> | null = null;

type StatusListener = (status: ProxyStatus) => void;
const statusListeners = new Set<StatusListener>();

// Push proxy up/down transitions instead of making the UI poll for them. `running`
// reflects this process's own daemon handle (the daemon is main-resident), which is
// exactly the lifecycle the dashboard cares about.
export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

// The daemon's own handle is Forebay's single source of truth for "running": a health
// probe would also report true for any other process holding the port, which is not
// the lifecycle the dashboard controls.
function currentStatus(): ProxyStatus {
  return { running: handle !== null, port: resolveLocalApiPort(dashboardStoreDir()) };
}

function emitStatus(): void {
  const snapshot = currentStatus();
  for (const listener of statusListeners) {
    try { listener(snapshot); } catch { /* a bad listener must not break the daemon */ }
  }
}

function dashboardStoreDir(): string {
  return resolveStoreDir(process.env, process.platform, homedir());
}

// App-agnostic: the local API serves whichever proxy plugin is installed. It
// never names a specific app; the first installed proxy def wins (behaviour
// parity with a single-proxy setup).
export async function resolveProxyProfile(
  deps: { defs?: () => Promise<LoadedProxyDef[]>; unresolved?: () => Promise<string[]> } = {},
): Promise<RoutingProfile> {
  const defs = await (deps.defs ?? (() => loadInstalledProxyDefs(dashboardStoreDir())))();
  const def = defs[0];
  if (def) return def.profile();
  const unresolved = await (deps.unresolved ?? (() => unresolvedProxyPlugins(dashboardStoreDir())))();
  if (unresolved.length > 0) throw new Error(`${unresolved[0]} is installed but the version in this home declares no plugin manifest; reinstall it from a channel that provides one, or wait for a release that does`);
  throw new Error("no proxy plugin installed");
}

export function buildStartOptions(configDir: string, profile: RoutingProfile): StartLoaderProxyOptions<RoutingProfile> {
  return {
    // basekit/loader's generic StartLoaderProxyOptions type-erases the handler-resolution
    // pipeline to `unknown` (it never depends on basekit/proxy's concrete ProxyHandler type,
    // per the core-libs-stay-generic rule); this cast bridges that intentional boundary,
    // the runtime pairing (makeDynamicResolver's output feeding createProxyServer's
    // resolveHandler) is exact since both come from the proxy module itself.
    createProxyServer: createProxyServer as StartLoaderProxyOptions<RoutingProfile>["createProxyServer"],
    makeDynamicResolver,
    profile,
    configDir,
    port: resolveLocalApiPort(configDir),
  };
}

export async function status(): Promise<ProxyStatus> {
  return currentStatus();
}

export async function start(
  starter: Starter = startLoaderProxy,
  resolveProfile: () => Promise<RoutingProfile> = () => resolveProxyProfile(),
): Promise<void> {
  if (handle) return;
  if (startingPromise) return startingPromise;
  startingPromise = (async () => {
    const configDir = dashboardStoreDir();
    if (!process.env.HUB_CONFIG_DIR) process.env.HUB_CONFIG_DIR = configDir;
    const profile = await resolveProfile();
    handle = await starter(buildStartOptions(configDir, profile));
  })();
  try {
    await startingPromise;
    emitStatus();
  } finally {
    startingPromise = null;
  }
}

export async function stop(): Promise<void> {
  if (!handle) return;
  if (stoppingPromise) return stoppingPromise;
  stoppingPromise = (async () => {
    await handle?.server.close?.();
    handle = null;
  })();
  try {
    await stoppingPromise;
    emitStatus();
  } finally {
    stoppingPromise = null;
  }
}
