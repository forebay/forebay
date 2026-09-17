<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Titlebar from "./lib/components/Titlebar.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import Skeleton from "./lib/components/Skeleton.svelte";
  import { router, nav, back, SCREENS, pluginOfScreen } from "./lib/router.js";
  import type { ScreenId } from "./lib/router.js";
  import PluginMenu from "./lib/routes/PluginMenu.svelte";

  // Routes load on first visit (code-split) instead of all up front.
  const ROUTES: Record<string, () => Promise<{ default: unknown }>> = {
    overview: () => import("./lib/routes/Overview.svelte"),
    providers: () => import("./lib/routes/Providers.svelte"),
    accounts: () => import("./lib/routes/Accounts.svelte"),
    routing: () => import("./lib/routes/Routing.svelte"),
    usage: () => import("./lib/routes/Usage.svelte"),
    activity: () => import("./lib/routes/Activity.svelte"),
    localApi: () => import("./lib/routes/LocalApi.svelte"),
    apps: () => import("./lib/routes/Apps.svelte"),
    plugins: () => import("./lib/routes/Plugins.svelte"),
    libraries: () => import("./lib/routes/Libraries.svelte"),
    downloads: () => import("./lib/routes/Downloads.svelte"),
    settings: () => import("./lib/routes/Settings.svelte"),
  };

  function loadRoute(screen: ScreenId): Promise<{ default: unknown }> {
    return (ROUTES[screen] ?? ROUTES.overview)();
  }
  import { forebay } from "./lib/ipc.js";
  import { fadeMotion } from "./lib/util/motion.js";
  import { watchDownloadProgress } from "./lib/downloadProgress.js";
  import { watchJobs } from "./lib/downloads.js";
  import { watchActivityErrors } from "./lib/stores/activity.js";
  import ToastHost from "./lib/components/ToastHost.svelte";

  const contributedScreen = $derived(pluginOfScreen($router.screen));
  const activeLabel = $derived(SCREENS.find((screen) => screen.id === $router.screen)?.label ?? contributedScreen?.plugin ?? "");

  // Depend only on the screen value, never the whole router store: a route that
  // mutates params in onMount (Plugins clears its deep-link param) must not make
  // this re-import and remount the route in a loop.
  const screen = $derived($router.screen);
  const routeModule = $derived(loadRoute(screen));

  let brandTag = $state("AI control plane");

  let stopProgress: (() => void) | undefined;
  let stopJobs: (() => void) | undefined;
  let stopActivityWatch: (() => void) | undefined;
  onDestroy(() => {
    stopProgress?.();
    stopJobs?.();
    stopActivityWatch?.();
  });

  onMount(async () => {
    stopProgress = watchDownloadProgress();
    stopJobs = watchJobs();
    stopActivityWatch = watchActivityErrors();
    // Brand tag lists the managed apps from registry data, never hardcoded names.
    const apps = await forebay.appsList();
    if (apps.ok && apps.data.length > 0) brandTag = apps.data.map((a) => a.label).join(" · ");
  });
</script>

<div class="window">
  <Titlebar title="Forebay" subtitle={activeLabel} />
  <div class="shell">
    <Sidebar {brandTag} />
    <main class="main">
      {#key screen}
        <div class="screen" in:fadeMotion={{ duration: 120 }}>
          {#if $nav.redirected}
            <button class="backbar" onclick={back} title="Go back">‹ Back to {$nav.redirectLabel}</button>
          {/if}
          {#if contributedScreen}
            <PluginMenu plugin={contributedScreen.plugin} screenId={contributedScreen.screenId} />
          {:else}
            {#await routeModule}
              <div class="route-loading"><Skeleton height="80px" radius="12px" /></div>
            {:then module}
              {@const Route = module.default as typeof Skeleton}
              <Route />
            {:catch}
              <p class="route-error">Could not load this screen.</p>
            {/await}
          {/if}
        </div>
      {/key}
    </main>
  </div>
  <ToastHost />
</div>

<style>
  .window {
    width: 100%;
    height: 100%;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .shell {
    display: grid;
    grid-template-columns: 224px 1fr;
    flex: 1;
    min-height: 0;
  }
  @media (max-width: 899px) {
    .shell {
      grid-template-columns: 64px 1fr;
    }
  }
  .main {
    padding: 22px 26px;
    overflow: auto;
  }
  .backbar {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 14px;
    padding: 5px 12px 5px 9px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--ui);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .backbar:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .backbar:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .route-loading {
    padding: 8px 0;
  }
  .route-error {
    color: var(--crit);
    font-size: 13px;
  }
  @media (max-width: 640px) {
    .main {
      padding: 18px 16px;
    }
  }
</style>
