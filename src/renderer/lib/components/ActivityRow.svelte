<script lang="ts">
  import type { ActivityRecord, Impact } from "@forebay/shared";
  import { formatDuration } from "@forebay/shared";
  import { humanizeId } from "../util/appLabel.js";
  import { relativeTime } from "../util/time.js";

  let {
    record,
    follower = false,
    depth = 1,
    followerCount = 0,
    cascadeExpanded = false,
    onopen,
    oncascade,
  }: {
    record: ActivityRecord;
    follower?: boolean;
    depth?: number;
    followerCount?: number;
    cascadeExpanded?: boolean;
    onopen: () => void;
    oncascade?: () => void;
  } = $props();

  function impactVariant(impact: Impact): string {
    if (impact === "error") return "crit";
    if (impact === "warning") return "warn";
    if (impact === "notice") return "accent";
    if (impact === "info") return "muted";
    return "faint";
  }

  function impactGlyph(impact: Impact): string {
    if (impact === "error") return "!";
    if (impact === "warning") return "*";
    if (impact === "notice") return "+";
    if (impact === "info") return "-";
    return ".";
  }

  // A target that names neither an app nor a different home says nothing new. A home
  // with no app id shows its directory name, which reads better than a full path and
  // still names nothing specific.
  const targetLabel = $derived.by(() => {
    const target = record.target;
    if (!target) return "";
    if (target.app) return humanizeId(target.app);
    if (target.home && target.home !== record.origin?.home) return target.home.split(/[\\/]/).filter(Boolean).pop() ?? "";
    return "";
  });

  // Which copy ran this hop: the app and home it acted on plus its entry point, so a
  // flow naming several plugin managers says which one.
  const hopWhere = $derived.by(() => {
    const origin = record.origin;
    if (!origin) return "";
    return [origin.app ? humanizeId(origin.app) : "", origin.entry ?? ""].filter(Boolean).join(" - ");
  });

  const causeParts = $derived.by(() => {
    const parts: string[] = [];
    if (record.cause?.kind) parts.push(record.cause.kind);
    if (record.cause?.surface) parts.push(record.cause.surface);
    if (record.outcome) parts.push(record.outcome);
    if (typeof record.durationMs === "number") parts.push(formatDuration(record.durationMs));
    return parts;
  });

</script>

<div class="wrap" class:follower data-testid={follower ? "activity-hop" : undefined} style={follower ? `--depth: ${depth}` : undefined}>
  <div class="line">
    <button type="button" class="row" onclick={onopen} title={`Show ${record.action} in detail`}>
      <span class="impact impact-{impactVariant(record.impact)}" title={record.impact}>{impactGlyph(record.impact)}</span>
      <span class="text" title={record.text}>{record.text}</span>
      {#if record.origin?.app}
        <span class="badge">{humanizeId(record.origin.app)}</span>
      {/if}
      {#if targetLabel}
        <span class="badge badge-target" data-testid="activity-target">{targetLabel}</span>
      {/if}
      <span class="time">{relativeTime(record.ts)}</span>
    </button>
    {#if followerCount > 0 && oncascade}
      <button
        type="button"
        class="count"
        data-testid="activity-followers"
        aria-expanded={cascadeExpanded}
        aria-label={`${followerCount} caused by this`}
        onclick={oncascade}
      >+{followerCount}</button>
    {/if}
  </div>

  {#if follower && hopWhere}
    <p class="hop-where">{hopWhere}</p>
  {/if}

  {#if causeParts.length > 0}
    <p class="cause" data-testid="activity-cause">{causeParts.join(" / ")}</p>
  {/if}

</div>

<style>
  .wrap {
    border-bottom: 1px solid var(--border);
  }
  .follower {
    padding-left: calc(22px + (var(--depth, 1) - 1) * 16px);
    background: var(--bg-subtle, transparent);
    border-left: 1px solid var(--border);
  }
  .hop-where {
    margin: 0 0 4px 22px;
    font-size: 11px;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .impact {
    width: 14px;
    text-align: center;
    font-weight: 700;
  }
  .impact-crit { color: var(--crit); }
  .impact-warn { color: var(--warn); }
  .impact-accent { color: var(--accent); }
  .impact-muted { color: var(--muted); }
  .impact-faint { color: var(--border-strong); }
  .text {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .badge {
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
    white-space: nowrap;
  }
  .badge-target::before {
    content: "to ";
    color: var(--border-strong);
  }
  .line {
    display: flex;
    align-items: center;
  }
  .count {
    font-size: 11px;
    color: var(--accent);
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
    margin-right: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .time {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
  .cause {
    margin: 0 12px 7px 36px;
    font-size: 11px;
    color: var(--muted);
  }
</style>
