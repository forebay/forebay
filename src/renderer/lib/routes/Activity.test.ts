// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import Activity from "./Activity.svelte";
import type { ActivityRecord, Result } from "@forebay/shared";

function record(over: Partial<ActivityRecord> & { id: string }): ActivityRecord {
  return {
    id: over.id,
    ts: over.ts ?? Date.now(),
    home: over.home ?? "forebay",
    topic: over.topic ?? "config.changed",
    action: over.action ?? "config_changed",
    actor: over.actor ?? "user",
    impact: over.impact ?? "notice",
    source: over.source ?? "config-ledger",
    subject: over.subject,
    details: over.details ?? { key: "value" },
    text: over.text ?? "Something happened",
    // spread last so a test can supply any v2 field (origin, cause, trace, target)
    ...over,
  } as ActivityRecord;
}

beforeEach(() => {
  stubForebay({
    activityRead: async () => ({
      ok: true,
      data: {
        records: [
          record({ id: "e1", impact: "error", source: "core-proxy", topic: "provider.failed", text: "Upstream request failed" }),
          record({ id: "n1", impact: "notice", source: "config-ledger", topic: "config.changed", text: "Configuration saved" }),
        ],
      },
    }),
  });
});

async function mount() {
  const utils = render(Activity);
  // allow onMount async load to resolve
  await new Promise((r) => setTimeout(r, 0));
  return utils;
}

describe("Activity screen", () => {
  it("lists both loaded records", async () => {
    const { getByText } = await mount();
    expect(getByText("Upstream request failed")).toBeInTheDocument();
    expect(getByText("Configuration saved")).toBeInTheDocument();
  });

  it("hides other impacts when the error filter is toggled on", async () => {
    const { getByText, queryByText } = await mount();
    await fireEvent.click(getByText("error"));
    expect(getByText("Upstream request failed")).toBeInTheDocument();
    expect(queryByText("Configuration saved")).toBeNull();
  });

  it("filters by the app an event ran in", async () => {
    stubForebay({
      activityRead: async () => ({
        ok: true,
        data: {
          records: [
            record({ id: "a1", text: "In app one", origin: { app: "appone", home: "/h1" } }),
            record({ id: "a2", text: "In app two", origin: { app: "apptwo", home: "/h2" } }),
          ],
        },
      }),
    });
    const { getByLabelText, getByText, queryByText } = await mount();

    await fireEvent.change(getByLabelText("App"), { target: { value: "appone" } });

    expect(getByText("In app one")).toBeInTheDocument();
    expect(queryByText("In app two")).toBeNull();
  });

  it("filters by cause kind and by actor", async () => {
    stubForebay({
      activityRead: async () => ({
        ok: true,
        data: {
          records: [
            record({ id: "c1", text: "Started up", actor: "app", cause: { kind: "startup" } }),
            record({ id: "c2", text: "Clicked", actor: "user", cause: { kind: "user" } }),
          ],
        },
      }),
    });
    const { getByLabelText, getByText, queryByText } = await mount();

    await fireEvent.change(getByLabelText("Cause"), { target: { value: "startup" } });
    expect(getByText("Started up")).toBeInTheDocument();
    expect(queryByText("Clicked")).toBeNull();

    await fireEvent.change(getByLabelText("Cause"), { target: { value: "" } });
    await fireEvent.change(getByLabelText("Actor"), { target: { value: "user" } });
    expect(getByText("Clicked")).toBeInTheDocument();
    expect(queryByText("Started up")).toBeNull();
  });

  it("asks for older records bounded by the oldest one it already has, and keeps both pages", async () => {
    const NEWER_TS = Date.now() - 60_000;
    const OLDER_TS = Date.now() - 120_000;
    const calls: Record<string, unknown>[] = [];
    stubForebay({
      activityRead: async (query: Record<string, unknown>) => {
        calls.push(query);
        if (!query.cursor) {
          return { ok: true, data: { records: [record({ id: "new1", ts: NEWER_TS, text: "Newer event" })], nextCursor: "cursor-1" } };
        }
        return { ok: true, data: { records: [record({ id: "old1", ts: OLDER_TS, text: "Older event" })] } };
      },
    });
    const { getByRole, getByText } = await mount();

    await fireEvent.click(getByRole("button", { name: /load older/i }));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[1]).toMatchObject({ cursor: "cursor-1", until: NEWER_TS });
    expect(getByText("Newer event")).toBeInTheDocument();
    expect(getByText("Older event")).toBeInTheDocument();
  });

  it("offers no load-older control once the reader reports no further page", async () => {
    const { queryByRole } = await mount();
    expect(queryByRole("button", { name: /load older/i })).toBeNull();
  });

  it("hides an event's cascade until the group is expanded", async () => {
    const now = Date.now();
    stubForebay({
      activityRead: async () => ({
        ok: true,
        data: {
          records: [
            record({ id: "root", ts: now - 2000, text: "Installed a plugin", trace: { id: "t1" } }),
            record({ id: "kid", ts: now - 1000, text: "Registered an app", trace: { id: "t1", causedBy: "root" } }),
          ],
        },
      }),
    });
    const { getByText, queryByText, getByTestId } = await mount();

    expect(getByText("Installed a plugin")).toBeInTheDocument();
    expect(queryByText("Registered an app")).toBeNull();

    await fireEvent.click(getByTestId("activity-followers"));
    expect(getByText("Registered an app")).toBeInTheDocument();
  });

  it("keeps a live record that arrives before the initial load resolves", async () => {
    type ReadResult = Result<{ records: ActivityRecord[] }>;
    let resolveLoad: ((value: ReadResult) => void) | undefined;
    const pending = new Promise<ReadResult>((resolve) => {
      resolveLoad = resolve;
    });
    let liveHandler: ((r: ActivityRecord) => void) | undefined;
    stubForebay({
      activityRead: async () => pending,
      onActivityEvent: (listener) => {
        liveHandler = listener;
        return () => {};
      },
    });

    const { getByText } = render(Activity);
    // let onMount run and the activityRead call start, without resolving it yet
    await new Promise((r) => setTimeout(r, 0));

    liveHandler?.(record({ id: "live1", impact: "error", text: "Live-arrived failure" }));

    resolveLoad?.({
      ok: true,
      data: { records: [record({ id: "n1", impact: "notice", text: "Configuration saved" })] },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(getByText("Live-arrived failure")).toBeInTheDocument();
    expect(getByText("Configuration saved")).toBeInTheDocument();
  });
});
