<script lang="ts">
  import { onMount } from "svelte";
  import { router, navigate, SCREENS, pluginScreen, setPluginScreens } from "../router.js";
  import type { ScreenId } from "../router.js";
  import { forebay } from "../ipc.js";
  import type { PluginScreen } from "@forebay/shared";
  import { serverStatus, watchServerStatus } from "../serverStatus.js";
  import { unseenErrorCount } from "../stores/activity.js";
  import { PROXY_PORT } from "@forebay/shared";
  import ForebayMark from "./ForebayMark.svelte";

  let {
    brandName = "Forebay",
    brandTag = "AI control plane",
    apiPort = PROXY_PORT,
  }: { brandName?: string; brandTag?: string; apiPort?: number } = $props();

  const mainScreens = $derived(SCREENS.filter((screen) => screen.section === "main"));
  const networkScreens = SCREENS.filter((screen) => screen.section === "network");

  // Three states, because "not yet known" must not read as running.
  const known = $derived($serverStatus !== null);
  const running = $derived($serverStatus?.running === true);
  const port = $derived($serverStatus?.port ?? apiPort);

  // Painted from the last known set so the sidebar never waits, then replaced by a background refresh.
  let pluginScreens = $state<PluginScreen[]>([]);

  function apply(screens: PluginScreen[]): void {
    pluginScreens = screens;
    setPluginScreens(screens);
  }

  onMount(() => {
    void forebay.screensList().then((cached) => {
      if (cached.ok && cached.data?.length > 0) apply(cached.data);
      return forebay.screensList({ wait: true }).then((fresh) => {
        if (fresh.ok) apply(fresh.data);
      });
    });
    return watchServerStatus();
  });

  function go(id: ScreenId): (event: MouseEvent) => void {
    return (event: MouseEvent) => {
      event.preventDefault();
      navigate(id);
    };
  }
</script>

<aside class="side">
  <div class="brand">
    <ForebayMark size={28} />
    <div class="bname"><b>{brandName}</b><small>{brandTag}</small></div>
  </div>
  <nav class="nav">
    {#each mainScreens as screen (screen.id)}
      <button type="button" class={$router.screen === screen.id ? "active" : ""} title={screen.label} onclick={go(screen.id)}>
        <span class="ic">{screen.glyph}</span> <span class="lbl">{screen.label}</span>
        {#if screen.id === "activity" && $unseenErrorCount > 0}
          <span class="badge">{$unseenErrorCount > 99 ? "99+" : $unseenErrorCount}</span>
        {/if}
      </button>
    {/each}
  </nav>
  <div class="navsec"><p class="label">Network</p></div>
  <nav class="nav">
    {#each networkScreens as screen (screen.id)}
      <button type="button" class={$router.screen === screen.id ? "active" : ""} title={screen.label} onclick={go(screen.id)}>
        <span class="ic">{screen.glyph}</span> <span class="lbl">{screen.label}</span>
      </button>
    {/each}
  </nav>
  {#if pluginScreens.length > 0}
    <div class="navsec"><p class="label">Plugins</p></div>
    <nav class="nav">
      {#each pluginScreens as screen (screen.plugin + ":" + screen.id)}
        {@const id = pluginScreen(screen.plugin, screen.id)}
        <button type="button" class={$router.screen === id ? "active" : ""} title={screen.label} onclick={go(id)}>
          <span class="ic">{screen.glyph ?? "◇"}</span> <span class="lbl">{screen.label}</span>
        </button>
      {/each}
    </nav>
  {/if}
  <div class="foot" title={known ? `Local API :${port} ${running ? "running" : "stopped"}` : "Local API status unknown"}>
    <span class="dot" class:off={known && !running} class:unknown={!known}></span>
    <span class="foottext">Local API · <span class="num">:{port}</span></span>
  </div>
</aside>

<style>
  .side {
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 14px;
  }
  .brand b {
    font-size: 14.5px;
    letter-spacing: -.01em;
  }
  .brand small {
    display: block;
    color: var(--faint);
    font-size: 10.5px;
    letter-spacing: .02em;
    margin-top: 1px;
  }
  .navsec {
    margin: 12px 8px 4px;
  }
  .nav button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-family: var(--ui);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .nav button .ic {
    width: 16px;
    text-align: center;
    opacity: .8;
  }
  .nav button .badge {
    margin-left: auto;
    background: var(--crit-weak);
    color: var(--crit);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 20px;
  }
  .nav button:hover {
    background: var(--surface);
    color: var(--text);
  }
  .nav button.active {
    background: var(--accent-weak);
    color: var(--accent);
    font-weight: 600;
  }
  .nav button.active .ic {
    opacity: 1;
  }
  .nav button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .side .foot {
    margin-top: auto;
    padding: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 11.5px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--good);
    box-shadow: 0 0 0 3px var(--good-weak);
    flex: none;
  }
  .dot.off {
    background: var(--faint);
    box-shadow: 0 0 0 3px var(--surface-2);
  }
  .dot.unknown {
    background: var(--border-strong);
    box-shadow: none;
  }

  /* Narrow window: collapse to an icon rail */
  @media (max-width: 899px) {
    .side {
      padding: 16px 8px;
      align-items: stretch;
    }
    .brand {
      justify-content: center;
      padding: 6px 0 14px;
    }
    .brand .bname {
      display: none;
    }
    .nav button {
      justify-content: center;
      padding: 9px 0;
      position: relative;
    }
    .nav button .lbl {
      display: none;
    }
    .nav button .badge {
      position: absolute;
      top: 3px;
      right: 6px;
      margin-left: 0;
      font-size: 9px;
      padding: 1px 4px;
    }
    .navsec {
      display: none;
    }
    .side .foot {
      justify-content: center;
    }
    .side .foot .foottext {
      display: none;
    }
  }
</style>
