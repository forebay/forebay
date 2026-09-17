<script lang="ts">
  import type { HostApp } from "@forebay/shared";
  import PluginIcon from "./PluginIcon.svelte";

  let { apps, values, onToggle, size = 22 }: {
    apps: HostApp[];
    values: Record<string, boolean>;
    onToggle?: (appId: string, on: boolean) => void;
    size?: number;
  } = $props();
</script>

<div class="apps">
  {#each apps as app (app.id)}
    {@const on = !!values[app.id]}
    {@const interactive = !!onToggle}
    <svelte:element
      this={interactive ? "button" : "span"}
      role={interactive ? "button" : undefined}
      class="app"
      class:on
      class:na={!on}
      title={app.label}
      aria-label={interactive ? `${app.label}: ${on ? "installed, click to remove" : "click to install"}` : app.label}
      style="width:{size}px;height:{size}px"
      onclick={interactive ? () => onToggle?.(app.id, !on) : undefined}
    >
      <PluginIcon icon={app.icon} name={app.label} {size} />
    </svelte:element>
  {/each}
</div>

<style>
  .apps {
    display: flex;
    gap: 6px;
  }
  .app {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    border-radius: 6px;
    cursor: default;
    overflow: hidden;
    transition: opacity 0.14s ease, filter 0.14s ease, transform 0.14s ease;
  }
  button.app {
    cursor: pointer;
  }
  button.app:hover {
    transform: translateY(-1px);
  }
  /* Not installed on this app: desaturated + dimmed, but still recognizable. */
  .app.na {
    filter: grayscale(0.85);
    opacity: 0.4;
  }
  .app.on {
    box-shadow: 0 0 0 1.5px var(--accent-border);
  }
</style>
