// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { unseenErrorCount, watchActivityErrors, setActivityActive } from "./activity.js";
import type { ActivityRecord } from "@forebay/shared";

function errorRecord(id: string): ActivityRecord {
  return { id, ts: Date.now(), home: "forebay", topic: "provider.failed", action: "failed", actor: "system", impact: "error", source: "core-proxy", details: {}, text: "Upstream failed" };
}

describe("activity store", () => {
  let liveHandler: ((record: ActivityRecord) => void) | undefined;

  beforeEach(() => {
    liveHandler = undefined;
    stubForebay({
      onActivityEvent: (listener) => {
        liveHandler = listener;
        return () => {};
      },
    });
  });

  it("counts error-impact pushes while inactive, and suppresses them while active", () => {
    watchActivityErrors();

    liveHandler?.(errorRecord("e1"));
    expect(get(unseenErrorCount)).toBe(1);

    setActivityActive(true);
    expect(get(unseenErrorCount)).toBe(0);

    liveHandler?.(errorRecord("e2"));
    expect(get(unseenErrorCount)).toBe(0);

    setActivityActive(false);
    liveHandler?.(errorRecord("e3"));
    expect(get(unseenErrorCount)).toBe(1);
  });
});
