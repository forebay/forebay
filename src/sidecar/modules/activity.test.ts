import { describe, it, expect } from "vitest";
import { activityRead } from "./activity.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";
import type { ActivityRecord } from "@intisy-ai/basekit";

function home(id: string, dir: string, present = true): PluginHome {
  return { id, label: id, dir, present, managesPlugins: true };
}

function record(id: string, home: string): ActivityRecord {
  return { id, ts: 1, home, topic: "config.changed", action: "config_changed", actor: "user", impact: "notice", source: "config-ledger", details: {}, text: "Config changed" };
}

describe("sidecar activity module", () => {
  it("reads activity across present homes and excludes absent ones", async () => {
    let seenHomes: string[] = [];
    const res = await activityRead({ impacts: ["notice"] }, {
      homes: async () => [home("forebay", "/forebay"), home("claude", "/c"), home("opencode", "/o", false)],
      read: (homes, q) => {
        seenHomes = homes;
        expect(q.impacts).toEqual(["notice"]);
        return { records: [record("1", "/forebay"), record("2", "/c")], nextCursor: undefined };
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(seenHomes).toEqual(["/forebay", "/c"]);
    expect(res.data.records.map((r) => r.id)).toEqual(["1", "2"]);
    expect(res.data.nextCursor).toBeUndefined();
  });

  it("sums activity storage across the present homes only", async () => {
    const { activityStatsRead } = await import("./activity.js");
    const seen: string[][] = [];
    const res = await activityStatsRead({
      homes: async () => [home("forebay", "/forebay"), home("claude", "/c", false)],
      stats: (dirs) => { seen.push(dirs); return { homes: [], bytes: 42, segments: 1 }; },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.bytes).toBe(42);
    expect(seen).toEqual([["/forebay"]]);
  });

  it("propagates a paging cursor from the reader", async () => {
    const res = await activityRead({}, {
      homes: async () => [home("forebay", "/forebay")],
      read: () => ({ records: [record("1", "/forebay")], nextCursor: "AQ==" }),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nextCursor).toBe("AQ==");
  });
});
