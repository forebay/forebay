import { describe, it, expect } from "vitest";
import { busDrain } from "./bus.js";
import type { PluginHome } from "../../../packages/shared/src/domain.js";

function home(id: string, dir: string, present = true): PluginHome {
  return { id, label: id, dir, present, managesPlugins: true };
}

describe("sidecar bus module", () => {
  it("drains present home buses and maps envelopes to BusEvent", async () => {
    let seenHomes: string[] = [];
    const res = await busDrain({
      homes: async () => [home("forebay", "/forebay"), home("claude", "/c"), home("opencode", "/o", false)],
      drain: (homes, _id, handler) => {
        seenHomes = homes;
        handler({ v: 1, id: "1", ts: 111, topic: "config.snapshot", source: "config-ledger", payload: { reason: "manual" } });
        return 1;
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(seenHomes).toEqual(["/forebay", "/c"]); // absent opencode excluded
    expect(res.data).toEqual([{ topic: "config.snapshot", source: "config-ledger", ts: 111, payload: { reason: "manual" } }]);
  });
});
