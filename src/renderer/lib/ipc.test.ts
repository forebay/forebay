// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/svelte";
import { INVOKE_CHANNELS, isReadOnlyChannel } from "@forebay/shared";
import { stubForebay, defaultForebay } from "./testing.js";
import { forebay, classify, classifiedReadNames, type IpcKind } from "./ipc.js";
import Overview from "./routes/Overview.svelte";

// Every ForebayAPI method, by how the proxy must treat it. A method absent here, or
// classified differently by ipc.ts, fails the drift test below: an unclassified read
// falls through to the mutation branch and silently wipes every screen's cache.
const EXPECTED: Record<string, IpcKind> = {
  overviewSummary: "cached", accountsList: "cached", providersList: "cached", routingApps: "cached",
  routingGet: "cached", proxyStatus: "cached", appsDetect: "cached", appsList: "cached",
  appsSummary: "cached", appStorageGet: "cached", pluginsList: "cached", pluginsListCached: "cached",
  pluginsData: "cached", librariesList: "cached", configSchemas: "cached", getConfig: "cached",
  usageSnapshot: "cached", importApps: "cached", importPreview: "cached", catalogList: "cached",
  customEndpointsList: "cached", screensList: "cached", settingsSections: "cached",
  githubStatus: "cached", activityRead: "cached",

  proxiesList: "live", jobsList: "live", appsConnection: "live", repoMeta: "live",
  repoMetaCached: "live", pluginVersions: "live", pluginVersionsAll: "live",
  pluginVersionsCached: "live", enginesList: "live", screenData: "live",
  activityStats: "live", globalSettingsRead: "live", catalogListCached: "live",
  favoritesList: "live", marketplaceSourcesList: "live", customEndpointsFormats: "live",
  pluginLedger: "live", pluginQuarantine: "live",

  minimize: "passthrough", maximize: "passthrough", close: "passthrough",
  onServerStatus: "passthrough", onDownloadProgress: "passthrough",
  onActivityEvent: "passthrough", onJobEvent: "passthrough",

  setConfig: "mutation", accountsEnable: "mutation", accountsRemove: "mutation",
  accountsRefreshQuota: "mutation", accountsLoginBegin: "mutation", accountsLoginComplete: "mutation",
  accountsLoginCancel: "mutation", providersSetEnabled: "mutation", providersSetExposure: "mutation",
  routingSetChain: "mutation", proxyStart: "mutation", proxyStop: "mutation",
  proxiesSetEnabled: "mutation", jobsEnqueue: "mutation", jobsCancel: "mutation",
  jobsClearFinished: "mutation", appsInstallCli: "mutation", appsUninstallCli: "mutation",
  appsInstallLoader: "mutation", appStorageSet: "mutation", librariesRemove: "mutation",
  enginesEnsure: "mutation", pluginsInstall: "mutation", pluginsRemoveEverywhere: "mutation",
  pluginsSetEnabled: "mutation", pluginsSetAutoUpdate: "mutation", pluginsSetChannel: "mutation", pluginsDowngrade: "mutation",
  pluginsUninstall: "mutation", pluginsRemoveData: "mutation", configWrite: "mutation",
  configAction: "mutation", screenInvoke: "mutation", busDrain: "mutation",
  updatesCheck: "mutation", updatesOne: "mutation", updatesAll: "mutation", importRun: "mutation",
  githubAddAccount: "mutation", githubSwitchAccount: "mutation", githubRemoveAccount: "mutation",
  githubConnectGhCli: "mutation", githubSetStar: "mutation", githubStarForebay: "mutation",
  githubDeviceStart: "mutation", githubDevicePoll: "mutation", favoritesToggle: "mutation",
  marketplaceSourcesSave: "mutation", customEndpointsUpsert: "mutation",
  customEndpointsRemove: "mutation", customEndpointsSaveKey: "mutation",
};

describe("forebay proxy", () => {
  it("reads window.forebay lazily, so a stub installed after import still resolves", async () => {
    const data = {
      providersConnected: 3,
      accountsTotal: 5,
      accountsEnabled: 4,
      appsDetected: 1,
      pluginsInstalled: 2,
      providerHealth: [],
      serverRunning: true,
      serverPort: 34567,
    };
    stubForebay({ overviewSummary: async () => ({ ok: true, data }) });

    const result = await forebay.overviewSummary();
    expect(result).toEqual({ ok: true, data });
  });

  it("lets a component that imported { forebay } before the stub see the stubbed value", async () => {
    stubForebay({
      overviewSummary: async () => ({
        ok: true,
        data: {
          providersConnected: 7,
          accountsTotal: 12,
          accountsEnabled: 9,
          appsDetected: 1,
          pluginsInstalled: 2,
          providerHealth: [],
          serverRunning: false,
          serverPort: 34567,
        },
      }),
    });

    const { getByText } = render(Overview);

    await waitFor(() => {
      expect(getByText("7")).toBeTruthy();
      expect(getByText("9")).toBeTruthy();
    });
  });
});

describe("method classification", () => {
  const methods = Object.entries(defaultForebay())
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);

  it("classifies every ForebayAPI method deliberately", () => {
    const unclassified = methods.filter((name) => !(name in EXPECTED));
    expect(unclassified).toEqual([]);
    expect(Object.keys(EXPECTED).filter((name) => !methods.includes(name))).toEqual([]);
    for (const name of methods) expect([name, classify(name)]).toEqual([name, EXPECTED[name]]);
  });

  it("maps every cached or live read to a real invoke channel, so window.forebay[name] is never silently undefined", () => {
    const orphaned = classifiedReadNames().filter((name) => !(name in INVOKE_CHANNELS));
    expect(orphaned).toEqual([]);
  });

  it("keeps every cached or live read's channel out of the activity log's user-action bucket", () => {
    const channels = INVOKE_CHANNELS as Record<string, string>;
    const misattributed = classifiedReadNames().filter((name) => !isReadOnlyChannel(channels[name]));
    expect(misattributed).toEqual([]);
  });

  it("keeps another screen's cached read across a live read", async () => {
    const appsList = vi.fn(async () => ({ ok: true as const, data: [] }));
    stubForebay({ appsList });

    await forebay.appsList();
    await forebay.jobsList();
    await forebay.appsList();

    expect(appsList).toHaveBeenCalledTimes(1);
  });

  it("drops it across a mutation", async () => {
    const appsList = vi.fn(async () => ({ ok: true as const, data: [] }));
    stubForebay({ appsList });

    await forebay.appsList();
    await forebay.proxyStart();
    await forebay.appsList();

    expect(appsList).toHaveBeenCalledTimes(2);
  });

  it("sends a repeated storage write through rather than answering it from the cache", async () => {
    const appStorageSet = vi.fn(async () => ({ ok: true as const, data: { names: { repos: "r", plugin: "p", cache: "c", config: "cfg" }, moves: [] } }));
    stubForebay({ appStorageSet });

    const names = { repos: "r", plugin: "p", cache: "c", config: "cfg" };
    await forebay.appStorageSet("claude", names);
    await forebay.appStorageSet("claude", names);

    expect(appStorageSet).toHaveBeenCalledTimes(2);
  });

  it("returns a subscription's unsubscribe function, not a promise of one", () => {
    stubForebay();
    expect(typeof forebay.onJobEvent(() => {})).toBe("function");
  });
});
