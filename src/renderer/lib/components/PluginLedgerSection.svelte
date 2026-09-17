<script lang="ts">
  import type { HomeLedger, LedgerRowView, PluginHome, QuarantineView } from "@forebay/shared";
  import Chip from "./Chip.svelte";

  let { groups, plugin, quarantine = [] }: { groups: HomeLedger[]; plugin: string; quarantine?: QuarantineView[] } = $props();

  type MatchedGroup = { home: PluginHome; row: LedgerRowView };

  const matched = $derived(
    groups.reduce<MatchedGroup[]>((acc, group) => {
      const row = group.rows.find((r) => r.pluginId === plugin);
      if (row) acc.push({ home: group.home, row });
      return acc;
    }, []),
  );

  // A home never has both a ledger row and a quarantine record for the same plugin, but the
  // filter keeps the ledger row authoritative if it ever did.
  const matchedHomeIds = $derived(new Set(matched.map((entry) => entry.home.id)));
  const quarantined = $derived(
    quarantine.filter((record) => record.pluginId === plugin && !matchedHomeIds.has(record.homeId)),
  );
</script>

{#if matched.length === 0 && quarantined.length === 0}
  <p class="muted">Not loaded in any home.</p>
{:else}
  <div class="groups">
    {#each matched as entry (entry.home.id)}
      <section class="group">
        <h3 class="home">{entry.home.label}</h3>

        {#if entry.row.error}
          <div class="error">
            <p class="label">Error</p>
            <p class="errdetail">{entry.row.error.detail}</p>
            <p class="errfix">{entry.row.error.fix}</p>
          </div>
        {/if}

        <div class="list">
          <p class="label">Capabilities</p>
          {#if entry.row.capabilitiesDeclared.length > 0}
            <div class="chiprow">
              {#each entry.row.capabilitiesDeclared as id (id)}
                {@const provided = entry.row.capabilities.includes(id)}
                <div class="item">
                  <Chip label={id} />
                  {#if !provided}<span class="marker">declared but not provided</span>{/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="muted">No capabilities declared.</p>
          {/if}
        </div>

        <div class="list">
          <p class="label">Provides</p>
          {#if entry.row.provides.length > 0}
            <div class="chiprow">
              {#each entry.row.provides as id (id)}<Chip label={id} />{/each}
            </div>
          {:else}
            <p class="muted">Nothing provided.</p>
          {/if}
        </div>

        <div class="list">
          <p class="label">Consumes</p>
          {#if entry.row.consumes.length > 0}
            <div class="chiprow">
              {#each entry.row.consumes as id (id)}
                {@const unresolved = entry.row.unresolved.includes(id)}
                <div class="item">
                  <Chip label={id} />
                  {#if unresolved}<span class="marker">nothing in this home provides it</span>{/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="muted">Nothing consumed.</p>
          {/if}
        </div>

        <div class="list">
          <p class="label">Topics</p>
          {#if entry.row.topics.length > 0}
            <div class="chiprow">
              {#each entry.row.topics as id (id)}<Chip label={id} />{/each}
            </div>
          {:else}
            <p class="muted">No topics subscribed.</p>
          {/if}
        </div>

        <div class="list">
          <p class="label">Permissions</p>
          {#if entry.row.permissions.length > 0}
            <div class="chiprow">
              {#each entry.row.permissions as id (id)}<Chip label={id} />{/each}
            </div>
          {:else}
            <p class="muted">No permissions requested.</p>
          {/if}
        </div>
      </section>
    {/each}
    {#each quarantined as record (record.homeId)}
      <section class="group">
        <h3 class="home">{record.homeLabel}</h3>
        <div class="error">
          <p class="label">Not loaded</p>
          <p class="errdetail">{record.detail}</p>
          <p class="errfix">{record.fix}</p>
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xl);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    padding: var(--space-xl);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .home {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 650;
    letter-spacing: -.01em;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .chiprow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .marker {
    font-size: var(--fs-micro);
    color: var(--warn);
  }
  .error {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    padding: var(--space-md) var(--space-lg);
    border: 1px solid var(--crit);
    border-radius: var(--radius-sm);
    background: var(--crit-weak);
  }
  .errdetail {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text);
  }
  .errfix {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .muted {
    margin: 0;
    color: var(--faint);
    font-size: var(--fs-sm);
  }
</style>
