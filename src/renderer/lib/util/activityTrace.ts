import type { ActivityRecord } from "@forebay/shared";

export interface ActivityHop {
  record: ActivityRecord;
  depth: number;
}

export interface ActivityGroup {
  root: ActivityRecord;
  followers: ActivityHop[];
}

// One group per trace, flattened depth-first so a caller can render the chain with a
// plain each-block. A page can begin mid-trace (its root is on an older page), so the
// oldest record loaded for that trace stands in as the root, and a record whose parent
// is off the page hangs off that root rather than disappearing.
export function groupByTrace(records: ActivityRecord[]): ActivityGroup[] {
  const byTrace = new Map<string, ActivityRecord[]>();
  for (const record of records) {
    const key = record.trace?.id || record.id;
    const list = byTrace.get(key) ?? [];
    list.push(record);
    byTrace.set(key, list);
  }

  const groups: ActivityGroup[] = [];
  for (const list of byTrace.values()) {
    const ordered = list.slice().sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    const rootIndex = ordered.findIndex((r) => !r.trace?.causedBy);
    const root = rootIndex >= 0 ? ordered[rootIndex] : ordered[0];

    const present = new Set(ordered.map((r) => r.id));
    const children = new Map<string, ActivityRecord[]>();
    for (const record of ordered) {
      if (record === root) continue;
      const parentId = record.trace?.causedBy;
      const key = parentId && parentId !== record.id && present.has(parentId) ? parentId : root.id;
      children.set(key, [...(children.get(key) ?? []), record]);
    }

    const followers: ActivityHop[] = [];
    const walk = (parentId: string, depth: number): void => {
      for (const child of children.get(parentId) ?? []) {
        followers.push({ record: child, depth });
        walk(child.id, depth + 1);
      }
    };
    walk(root.id, 1);

    groups.push({ root, followers });
  }

  return groups.sort((a, b) => newestTs(b) - newestTs(a) || a.root.id.localeCompare(b.root.id));
}

function newestTs(group: ActivityGroup): number {
  return group.followers.reduce((max, hop) => Math.max(max, hop.record.ts), group.root.ts);
}
