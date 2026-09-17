import { getConfigDir } from "@intisy-ai/basekit/auth";
import { listInstalledProxies as realListInstalledProxies } from "../lib/proxyPlugins.js";
import type { InstalledProxy } from "../lib/proxyPlugins.js";
import { pluginsSetEnabled as realPluginsSetEnabled } from "./plugins.js";
import type { ProxyView, Result, PluginHomeId } from "../../../packages/shared/src/domain.js";
import { wrap } from "../result.js";

export interface ProxiesDeps {
  storeDir?: string;
  listInstalledProxies?: (storeDir: string) => Promise<InstalledProxy[]>;
  pluginsSetEnabled?: (home: PluginHomeId, name: string, on: boolean) => Promise<Result<void>>;
}

export function proxiesList(deps: ProxiesDeps = {}): Promise<Result<ProxyView[]>> {
  return wrap(async () => {
    const list = deps.listInstalledProxies ?? realListInstalledProxies;
    const installed = await list(deps.storeDir ?? getConfigDir());
    const views: ProxyView[] = [];
    for (const proxy of installed) {
      if (!proxy.def) continue;
      views.push({ name: proxy.name, app: proxy.def.app, appLabel: proxy.def.label, enabled: proxy.enabled, setup: proxy.def.setup });
    }
    return views;
  });
}

export function proxiesSetEnabled(name: string, on: boolean, deps: ProxiesDeps = {}): Promise<Result<void>> {
  const setEnabled = deps.pluginsSetEnabled ?? realPluginsSetEnabled;
  return setEnabled("forebay", name, on);
}
