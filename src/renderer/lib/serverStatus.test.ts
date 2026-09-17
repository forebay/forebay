import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const pushed: Array<(status: unknown) => void> = [];
let statusResult: { ok: true; data: { running: boolean; port: number } } | { ok: false; error: string } = {
  ok: true, data: { running: false, port: 34567 },
};

vi.mock("./ipc.js", () => ({
  forebay: {
    proxyStatus: async () => statusResult,
    onServerStatus: (listener: (status: unknown) => void) => { pushed.push(listener); return () => {}; },
  },
}));

const { serverStatus, watchServerStatus } = await import("./serverStatus.js");

describe("serverStatus", () => {
  beforeEach(() => {
    serverStatus.set(null);
    pushed.length = 0;
    statusResult = { ok: true, data: { running: false, port: 34567 } };
  });

  it("starts unknown, because assuming running is what made a stopped proxy look online", () => {
    expect(get(serverStatus)).toBeNull();
  });

  // Status is pushed only on transitions, so a proxy that was already stopped at launch
  // never pushes anything and the store would stay unknown forever without this.
  it("fetches the current status once when it starts watching", async () => {
    watchServerStatus();
    await vi.waitFor(() => expect(get(serverStatus)).toEqual({ running: false, port: 34567 }));
  });

  it("applies later pushes over the initial fetch", async () => {
    watchServerStatus();
    await vi.waitFor(() => expect(get(serverStatus)).not.toBeNull());
    pushed[0]({ running: true, port: 34567 });
    expect(get(serverStatus)).toEqual({ running: true, port: 34567 });
  });

  it("leaves the status unknown when the fetch fails rather than claiming it is up", async () => {
    statusResult = { ok: false, error: "sidecar rpc timeout" };
    watchServerStatus();
    await new Promise((r) => setTimeout(r, 10));
    expect(get(serverStatus)).toBeNull();
  });
});
