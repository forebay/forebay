<script lang="ts">
  import type { ActivityRecord } from "@forebay/shared";
  import { formatDuration } from "@forebay/shared";
  import Button from "./Button.svelte";
  import StatusPill, { type StatusVariant } from "./StatusPill.svelte";
  import { humanizeId } from "../util/appLabel.js";
  import { relativeTime } from "../util/time.js";
  import Dialog from "./Dialog.svelte";

  let { record, onClose }: { record: ActivityRecord; onClose: () => void } = $props();

  let rawOpen = $state(false);



  function impactVariant(): StatusVariant {
    if (record.impact === "error") return "warn";
    if (record.impact === "warning") return "warn";
    if (record.impact === "notice") return "good";
    return "off";
  }

  function display(value: unknown): string {
    if (value === undefined) return "(unset)";
    if (value === null) return "null";
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function homeName(home: string | undefined): string {
    if (!home) return "";
    return home.split(/[\\/]/).filter(Boolean).pop() ?? home;
  }

  // One flat list so the dialog states every field the record carries and nothing it does
  // not: an empty row reads as missing data rather than as a field that never applied.
  const facts = $derived.by(() => {
    const rows: Array<{ label: string; value: string; mono?: boolean; title?: string }> = [
      { label: "When", value: `${new Date(record.ts).toLocaleString()} (${relativeTime(record.ts)})` },
      { label: "Action", value: record.action, mono: true },
      { label: "Topic", value: record.topic, mono: true },
      { label: "Actor", value: record.actor },
      { label: "Impact", value: record.impact },
    ];
    if (record.subject) {
      const subject = [record.subject.label, record.subject.id].filter(Boolean);
      rows.push({ label: "Subject", value: `${record.subject.kind}: ${subject.join(" / ") || "(unnamed)"}` });
    }
    if (record.outcome) rows.push({ label: "Outcome", value: record.outcome });
    if (typeof record.durationMs === "number") rows.push({ label: "Took", value: formatDuration(record.durationMs) });
    // Records written before origin/cause/trace existed are still in the bus, so every one
    // of them is optional here exactly as it is on the row.
    const origin = record.origin;
    if (origin) {
      rows.push({
        label: "Ran in",
        value: [origin.app ? humanizeId(origin.app) : "", origin.entry, homeName(origin.home)].filter(Boolean).join(" - "),
        title: origin.home,
      });
    }
    if (record.target?.app || record.target?.home) {
      rows.push({
        label: "Acted on",
        value: [record.target.app ? humanizeId(record.target.app) : "", homeName(record.target.home)].filter(Boolean).join(" - "),
        title: record.target.home,
      });
    }
    if (record.cause) rows.push({ label: "Cause", value: [record.cause.kind, record.cause.surface, record.cause.detail].filter(Boolean).join(" / ") });
    rows.push({ label: "Source", value: record.source, mono: true });
    if (record.trace) {
      rows.push({ label: "Trace", value: record.trace.causedBy ? `${record.trace.id} (caused by ${record.trace.causedBy})` : record.trace.id, mono: true });
    }
    return rows;
  });

  const detailEntries = $derived(Object.entries(record.details ?? {}));
</script>

<Dialog title={record.text} width="md" testid="activity-detail" {onClose}>
  {#snippet body()}
    <div class="impact"><StatusPill variant={impactVariant()} label={record.impact} /></div>
  <dl class="facts">
    {#each facts as fact (fact.label)}
      <dt>{fact.label}</dt>
      <dd class:mono={fact.mono} title={fact.title || undefined}>{fact.value}</dd>
    {/each}
  </dl>

  {#if record.changes && record.changes.length > 0}
    <section>
      <h4>Changes</h4>
      <table class="changes" data-testid="activity-changes">
        <tbody>
          {#each record.changes as change (change.key)}
            <tr>
              <td class="key">{change.key}</td>
              {#if change.redacted}
                <td class="redacted" colspan="2">redacted</td>
              {:else}
                <td class="from">{display(change.from)}</td>
                <td class="to">{display(change.to)}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if detailEntries.length > 0}
    <section>
      <h4>Details</h4>
      <dl class="facts">
        {#each detailEntries as [key, value] (key)}
          <dt>{key}</dt>
          <dd class="mono">{display(value)}</dd>
        {/each}
      </dl>
      <button type="button" class="raw-toggle" aria-expanded={rawOpen} onclick={() => (rawOpen = !rawOpen)}>
        {rawOpen ? "Hide" : "Show"} raw payload
      </button>
      {#if rawOpen}
        <pre class="raw" data-testid="activity-details">{JSON.stringify(record.details, null, 2)}</pre>
      {/if}
    </section>
  {/if}
  {/snippet}

  {#snippet actions()}
    <Button onclick={onClose}>Close</Button>
  {/snippet}
</Dialog>

<style>
  .impact {
    display: flex;
  }
  h4 {
    margin: 0 0 var(--space-xs);
    font-size: var(--fs-xs);
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2xs) var(--space-lg);
    margin: 0;
  }
  dt {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  dd {
    margin: 0;
    font-size: var(--fs-sm);
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--mono);
    font-size: var(--fs-xs);
  }
  .changes {
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  .changes td {
    padding: var(--space-3xs) var(--space-sm) var(--space-3xs) 0;
    vertical-align: top;
  }
  .key {
    color: var(--muted);
  }
  .from {
    text-decoration: line-through;
    opacity: .75;
  }
  .redacted {
    color: var(--warn);
    font-style: italic;
  }
  .raw-toggle {
    margin-top: var(--space-sm);
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    font-family: var(--ui);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .raw {
    margin: var(--space-xs) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow-x: auto;
  }
</style>
