import { describe, it, expect } from "vitest";
import type { ActivityRecord } from "@forebay/shared";
import { groupHistory } from "./downloadHistory.js";

function record(overrides: Partial<ActivityRecord> & { app?: string } = {}): ActivityRecord {
  const { app, ...rest } = overrides;
  return {
    id: Math.random().toString(36).slice(2),
    ts: 1000,
    home: "/h",
    topic: "plugin.installed",
    action: "installed",
    actor: "system",
    impact: "notice",
    source: "plugin-updater",
    subject: { kind: "plugin", id: "antigravity-auth", label: "antigravity-auth" },
    details: { version: "4c011a5b1234" },
    text: "",
    origin: { app: app ?? "claude", home: "/h" },
    cause: { kind: "user" },
    trace: { id: "t" },
    outcome: "ok",
    ...rest,
  } as ActivityRecord;
}

const installed = new Set(["antigravity-auth", "sync-bridge"]);

describe("groupHistory", () => {
  it("collapses one plugin at one version across homes into a single entry", () => {
    const entries = groupHistory([
      record({ app: "forebay", ts: 3 }),
      record({ app: "claude", ts: 2 }),
      record({ app: "opencode", ts: 1 }),
    ], { installed });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ plugin: "antigravity-auth", toVersion: "4c011a5b" });
    expect(entries[0].homes).toEqual(["forebay", "claude", "opencode"]);
  });

  // Recent describes where a plugin stands now, so an older version is superseded, not listed.
  it("keeps only the newest version of a plugin", () => {
    const entries = groupHistory([
      record({ ts: 2, details: { version: "aaaaaaaa1" } }),
      record({ ts: 1, details: { version: "bbbbbbbb1" } }),
    ], { installed });
    expect(entries).toHaveLength(1);
    expect(entries[0].toVersion).toBe("aaaaaaaa");
  });

  it("lists only the homes that carry the newest version", () => {
    const entries = groupHistory([
      record({ ts: 3, app: "forebay", details: { version: "newnewne1" } }),
      record({ ts: 2, app: "claude", details: { version: "newnewne1" } }),
      record({ ts: 1, app: "opencode", details: { version: "oldoldol1" } }),
    ], { installed });
    expect(entries[0].homes).toEqual(["forebay", "claude"]);
  });

  it("reports the newest outcome, so a fresh failure is what the row shows", () => {
    const entries = groupHistory([
      record({ ts: 2, outcome: "failed", details: { message: "update failed for antigravity-auth" } }),
      record({ ts: 1 }),
    ], { installed });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ failed: true, error: "update failed for antigravity-auth" });
  });

  it("reports an update as a version change", () => {
    const entries = groupHistory([record({ details: { fromVersion: "09412296aa", toVersion: "f8a1581dbb" } })], { installed });
    expect(entries[0]).toMatchObject({ fromVersion: "09412296", toVersion: "f8a1581d" });
  });

  it("leaves out plugins that are no longer installed", () => {
    const entries = groupHistory([
      record({ subject: { kind: "plugin", id: "removed-thing", label: "removed-thing" } } as Partial<ActivityRecord>),
      record(),
    ], { installed });
    expect(entries.map((e) => e.plugin)).toEqual(["antigravity-auth"]);
  });

  it("leaves out records with no plugin at all, like an updates-available notice", () => {
    expect(groupHistory([record({ subject: undefined, action: "updates_available" } as Partial<ActivityRecord>)], { installed })).toEqual([]);
  });

  it("honours a cleared cutoff", () => {
    const entries = groupHistory([record({ ts: 500 }), record({ ts: 1500, app: "opencode" })], { installed, hiddenBefore: 1000 });
    expect(entries).toHaveLength(1);
    expect(entries[0].homes).toEqual(["opencode"]);
  });

  it("orders newest first and caps the list", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      record({ ts: i, subject: { kind: "plugin", id: `p${i}`, label: `p${i}` } } as Partial<ActivityRecord>));
    const entries = groupHistory(many, { installed: new Set(many.map((_, i) => `p${i}`)), limit: 5 });
    expect(entries).toHaveLength(5);
    expect(entries[0].ts).toBe(59);
  });
});
