<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { PluginScreen } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import PageHeader from "../components/PageHeader.svelte";
  import Card from "../components/Card.svelte";
  import ErrorState from "../components/ErrorState.svelte";
  import Skeleton from "../components/Skeleton.svelte";
  import ScreenRenderer from "../components/screen/ScreenRenderer.svelte";

  let { plugin, screenId }: { plugin: string; screenId: string } = $props();

  let spec = $state<PluginScreen | null>(null);
  let homeId = $state("");
  let homeLabels = $state<Record<string, string>>({});
  let sources = $state<Record<string, unknown>>({});
  let notice = $state("");
  let loadError = $state("");
  let loaded = $state(false);
  let busy = $state(false);

  async function loadScreen(): Promise<void> {
    const [screens, sections] = await Promise.all([forebay.screensList(), forebay.pluginsList()]);
    if (!screens.ok) { loadError = screens.error; loaded = true; return; }
    spec = screens.data.find((s) => s.plugin === plugin && s.id === screenId) ?? null;
    homeId = spec?.homes[0] ?? "";
    if (sections.ok) homeLabels = Object.fromEntries(sections.data.map((s) => [s.home.id, s.home.label]));
    loaded = true;
  }

  async function loadData(): Promise<void> {
    if (!spec || !homeId) return;
    const requestedHome = homeId;
    const result = await forebay.screenData(plugin, screenId, homeId);
    if (requestedHome !== homeId) return;
    if (!result.ok) { loadError = result.error; return; }
    loadError = "";
    sources = result.data.sources;
  }

  async function invoke(actionId: string, args: Record<string, unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const result = await forebay.screenInvoke(plugin, screenId, actionId, homeId, args);
      if (!result.ok) { loadError = result.error; return; }
      notice = result.data.message ?? "";
      if (result.data.refresh) await loadData();
    } finally {
      busy = false;
    }
  }

  function labelFor(id: string): string {
    return homeLabels[id] ?? id;
  }

  // A failure to resolve the screen itself (spec still null) needs loadScreen re-run;
  // a failure reading the resolved screen's data needs loadData re-run instead.
  function retry(): void {
    if (spec) void loadData();
    else void loadScreen();
  }

  // The plugin names the topics its data depends on, so a change made anywhere (its own CLI,
  // another surface) repaints this screen without it polling for one.
  let poll: ReturnType<typeof setInterval> | undefined;
  async function follow(): Promise<void> {
    const prefixes = spec?.refreshOn ?? [];
    if (!prefixes.length) return;
    const events = await forebay.busDrain();
    if (events.ok && events.data.some((e) => prefixes.some((p) => e.topic.startsWith(p)))) await loadData();
  }

  $effect(() => { if (homeId) void loadData(); });

  onMount(() => {
    void loadScreen();
    poll = setInterval(follow, 5000);
  });
  onDestroy(() => { if (poll) clearInterval(poll); });
</script>

<PageHeader title={spec?.label ?? plugin} subtitle={`Contributed by ${plugin}.`} />

{#if !loaded}
  <Skeleton height="80px" radius="12px" />
{:else if loadError}
  <ErrorState message={loadError} onRetry={retry} />
{:else if !spec || spec.homes.length === 0}
  <Card><p class="empty">{plugin} is not installed in any app.</p></Card>
{:else}
  {#if spec.homes.length > 1}
    <div class="homes">
      {#each spec.homes as id (id)}
        <button class="hchip" class:on={homeId === id} onclick={() => (homeId = id)}>{labelFor(id)}</button>
      {/each}
    </div>
  {/if}
  {#if notice}<p class="notice">{notice}</p>{/if}
  <ScreenRenderer node={spec.layout} ctx={{ plugin, screenId, homeId, sources, invoke, busy }} />
{/if}

<style>
  .homes {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin: 0 2px 12px;
  }
  .hchip {
    font-size: 11.5px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--muted);
    border-radius: 20px;
    padding: 3px 11px;
    cursor: pointer;
  }
  .hchip.on {
    background: var(--accent-weak);
    color: var(--accent);
    border-color: var(--accent-border);
  }
  .empty {
    margin: 0;
    color: var(--faint);
    font-size: 12.5px;
  }
  .notice {
    margin: 0 2px 12px;
    color: var(--warn);
    font-size: 12.5px;
  }
</style>
