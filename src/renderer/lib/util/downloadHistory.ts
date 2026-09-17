import type { ActivityRecord } from "@forebay/shared";

// The log records one entry per plugin per home per version, so a plugin installed in three
// homes and updated twice produced six near-identical rows. Recent shows the CURRENT state
// instead: one row per plugin, at its newest version, listing the homes it landed in.

export interface HistoryEntry {
  key: string;
  plugin: string;
  homes: string[];
  fromVersion: string;
  toVersion: string;
  failed: boolean;
  error: string;
  ts: number;
}

function short(value: unknown): string {
  return typeof value === "string" && value ? value.slice(0, 8) : "";
}

function homeOf(record: ActivityRecord): string {
  return typeof record.origin?.app === "string" ? record.origin.app : "";
}

export interface GroupOptions {
  installed: Set<string>;
  hiddenBefore?: number;
  limit?: number;
}

export function groupHistory(records: ActivityRecord[], options: GroupOptions): HistoryEntry[] {
  const { installed, hiddenBefore = 0, limit = 40 } = options;
  const byPlugin = new Map<string, HistoryEntry>();
  // Newest first, so the first record seen for a plugin decides its version and outcome and
  // every later one can only contribute another home.
  const ordered = [...records].sort((a, b) => b.ts - a.ts);

  for (const record of ordered) {
    const plugin = record.subject?.id;
    if (!plugin || record.ts <= hiddenBefore) continue;
    // A log entry for something the user has since removed is history nobody can act on.
    if (!installed.has(plugin)) continue;

    const toVersion = short(record.details?.toVersion ?? record.details?.version);
    const home = homeOf(record);
    const existing = byPlugin.get(plugin);

    if (existing) {
      // Only the newest version's homes belong on the row; an older entry is superseded.
      if (existing.toVersion === toVersion && home && !existing.homes.includes(home)) {
        existing.homes.push(home);
      }
      continue;
    }

    const failed = record.outcome === "failed";
    byPlugin.set(plugin, {
      key: plugin,
      plugin,
      homes: home ? [home] : [],
      fromVersion: short(record.details?.fromVersion),
      toVersion,
      failed,
      error: failed && typeof record.details?.message === "string" ? record.details.message : "",
      ts: record.ts,
    });
  }

  return [...byPlugin.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
}
