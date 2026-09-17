<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount, untrack } from "svelte";
  import type { RepoMeta, CatalogKind } from "@forebay/shared";
  import { forebay } from "../ipc.js";
  import { renderMarkdown } from "../util/markdown.js";
  import PluginIcon, { LOGO_SIZE } from "./PluginIcon.svelte";
  import IconButton from "./IconButton.svelte";
  import { fadeMotion, flyMotion } from "../util/motion.js";

  let {
    repo,
    onClose,
    tabs = [],
    tabContent,
    onTab,
    actions,
    defaultTab,
    versionLabel,
  }: {
    repo: { name: string; url: string; kind?: CatalogKind; description?: string; topics?: string[]; displayName: string; icon?: string };
    onClose: () => void;
    tabs?: { id: string; label: string }[];
    tabContent?: Snippet<[string]>;
    // Lets a parent load a tab's data only once that tab is actually being shown.
    onTab?: (id: string) => void;
    actions?: Snippet;
    defaultTab?: string;
    versionLabel?: string;
  } = $props();

  const allTabs = $derived([{ id: "readme", label: "Readme" }, ...tabs]);
  let active = $state(untrack(() => defaultTab) ?? "readme");

  $effect(() => {
    onTab?.(active);
  });

  let meta = $state<RepoMeta | null>(null);
  let metaLoaded = $state(false);

  const description = $derived(meta?.description?.trim() ? meta.description : (repo.description ?? ""));
  const topics = $derived((meta && meta.topics.length > 0 ? meta.topics : repo.topics) ?? []);
  const stars = $derived(meta?.stars ?? null);
  const htmlUrl = $derived(meta?.htmlUrl ?? repo.url);
  const slug = $derived(meta ? `${meta.owner}/${meta.repo}` : repo.name);
  const readmeHtml = $derived(meta?.readme ? renderMarkdown(meta.readme) : "");

  function openGithub(): void {
    window.open(htmlUrl, "_blank");
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  onMount(() => {
    // Paint cached stars/readme instantly, then refresh from GitHub in the
    // background so the panel never opens to an empty "Loading…" state.
    forebay.repoMetaCached(repo.url).then((result) => {
      if (result.ok && result.data && !meta) {
        meta = result.data;
        metaLoaded = true;
      }
    });
    forebay.repoMeta(repo.url).then((result) => {
      if (result.ok) meta = result.data;
      metaLoaded = true;
    });
  });
</script>

<svelte:window onkeydown={onKeydown} />
<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()} transition:fadeMotion>
  <div class="modal" role="dialog" aria-modal="true" aria-label={`${repo.displayName} details`} transition:flyMotion={{ y: 12 }}>
    <header class="head">
      <PluginIcon icon={repo.icon} name={repo.displayName} kind={repo.kind} size={LOGO_SIZE.detail} />
      <div class="ident">
        <h2>{repo.displayName}</h2>
        <div class="sub">
          <span class="slug">{slug}</span>
          {#if versionLabel}<span class="version" title="Installed version">{versionLabel}</span>{/if}
          {#if repo.kind}<span class="kind">{repo.kind}</span>{/if}
          {#if stars !== null}<span class="stars" title="GitHub stars">★ {stars}</span>{/if}
        </div>
        {#if description}<p class="desc">{description}</p>{/if}
        {#if topics.length > 0}
          <div class="topics">
            {#each topics as topic (topic)}<span class="topic">{topic}</span>{/each}
          </div>
        {/if}
      </div>
      <div class="acts">
        {#if actions}{@render actions()}{/if}
        <IconButton name="github" title="View on GitHub" onclick={openGithub} />
        <IconButton name="close" title="Close" onclick={onClose} />
      </div>
    </header>

    <nav class="tabs">
      {#each allTabs as tab (tab.id)}
        <button class="tab" class:on={active === tab.id} onclick={() => (active = tab.id)}>{tab.label}</button>
      {/each}
    </nav>

    <div class="body">
      {#if active === "readme"}
        {#if readmeHtml}
          <div class="md">{@html readmeHtml}</div>
        {:else if !metaLoaded}
          <p class="muted">Loading readme…</p>
        {:else}
          <p class="muted">No readme available for this repository.</p>
        {/if}
      {:else if tabContent}
        {@render tabContent(active)}
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 41;
    background: rgba(0, 0, 0, .5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .modal {
    position: relative;
    width: min(94vw, 900px);
    height: min(90vh, 760px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: flex;
    gap: 16px;
    padding: 20px 22px;
    border-bottom: 1px solid var(--border);
  }
  .ident {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ident h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 650;
    letter-spacing: -.02em;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .slug {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--faint);
  }
  .version {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    background: var(--accent-weak);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .kind {
    font-size: 10px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 20px;
    padding: 2px 8px;
  }
  .stars {
    font-size: 11.5px;
    color: var(--muted);
    font-weight: 600;
  }
  .desc {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
  }
  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .topic {
    font-size: 10.5px;
    color: var(--faint);
    background: var(--surface-2);
    border-radius: 6px;
    padding: 2px 7px;
  }
  .acts {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    flex: none;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .tab {
    padding: 11px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-family: var(--ui);
    font-weight: 600;
    font-size: 12.5px;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .muted {
    margin: 0;
    color: var(--faint);
    font-size: 12.5px;
  }
  .md {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3) {
    letter-spacing: -.01em;
    margin: 16px 0 8px;
  }
  .md :global(h1) {
    font-size: 18px;
  }
  .md :global(h2) {
    font-size: 15.5px;
  }
  .md :global(h3) {
    font-size: 14px;
  }
  .md :global(h1:first-child),
  .md :global(h2:first-child) {
    margin-top: 0;
  }
  .md :global(p) {
    margin: 8px 0;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .md :global(code) {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .md :global(pre) {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
  }
  .md :global(pre code) {
    border: none;
    padding: 0;
    background: none;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 8px 0;
    padding-left: 22px;
  }
  .md :global(blockquote) {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid var(--border-strong);
    color: var(--muted);
  }
  .md :global(table) {
    border-collapse: collapse;
    margin: 8px 0;
    display: block;
    overflow-x: auto;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: 5px 9px;
    text-align: left;
  }
  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 14px 0;
  }
</style>
