// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ActivityRow from "./ActivityRow.svelte";
import type { ActivityRecord } from "@forebay/shared";

function record(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: "src-1",
    ts: Date.now(),
    home: "/tmp/home-a",
    topic: "plugin.installed",
    action: "updated",
    actor: "user",
    impact: "notice",
    source: "plugin-updater",
    subject: { kind: "plugin", id: "demo-plugin", label: "demo-plugin" },
    details: {},
    text: "Updated demo-plugin",
    origin: { app: "someapp", home: "/tmp/home-a" },
    cause: { kind: "user", surface: "plugins" },
    trace: { id: "trace-1" },
    ...overrides,
  } as ActivityRecord;
}

const noop = (): void => {};

describe("ActivityRow", () => {
  it("names the app it ran in, and the app it affected when they differ", () => {
    const { getByText, getByTestId } = render(ActivityRow, {
      props: { record: record({ target: { app: "otherapp", home: "/tmp/home-b" } }), onopen: noop },
    });
    // humanizeId is the tab's generic label helper, so an id renders capitalized
    expect(getByText("Someapp")).toBeInTheDocument();
    expect(getByTestId("activity-target")).toHaveTextContent("Otherapp");
  });

  it("shows no target badge when the action affected only its own app", () => {
    const { queryByTestId } = render(ActivityRow, { props: { record: record(), onopen: noop } });
    expect(queryByTestId("activity-target")).toBeNull();
  });

  it("falls back to the affected home when a target carries no app id", () => {
    const { getByTestId } = render(ActivityRow, {
      props: { record: record({ target: { home: "/tmp/home-b" } }), onopen: noop },
    });
    expect(getByTestId("activity-target")).toHaveTextContent("home-b");
  });

  it("states the cause and, when present, the outcome and duration", () => {
    const { getByTestId } = render(ActivityRow, {
      props: { record: record({ outcome: "failed", durationMs: 1500 }), onopen: noop },
    });
    const line = getByTestId("activity-cause");
    expect(line).toHaveTextContent("user");
    expect(line).toHaveTextContent("plugins");
    expect(line).toHaveTextContent("failed");
    expect(line).toHaveTextContent("1.5s");
  });

  it("shows sub-second durations in milliseconds", () => {
    const { getByTestId } = render(ActivityRow, {
      props: { record: record({ durationMs: 240 }), onopen: noop },
    });
    expect(getByTestId("activity-cause")).toHaveTextContent("240ms");
  });

  // The row is a summary; the payload lives in the detail dialog the row opens.
  it("asks for the record to be opened rather than expanding a payload in place", async () => {
    const onopen = vi.fn();
    const { getByRole, queryByTestId } = render(ActivityRow, {
      props: { record: record({ changes: [{ key: "logging", from: true, to: false }] }), onopen },
    });

    expect(queryByTestId("activity-changes")).toBeNull();
    expect(queryByTestId("activity-details")).toBeNull();

    await fireEvent.click(getByRole("button", { name: /Updated demo-plugin/ }));
    expect(onopen).toHaveBeenCalledTimes(1);
  });

  it("keeps the cascade toggle separate from the row's own control", () => {
    const { getByTestId, getByRole } = render(ActivityRow, {
      props: { record: record(), followerCount: 2, onopen: noop, oncascade: noop },
    });

    const cascade = getByTestId("activity-followers");
    expect(cascade).toHaveTextContent("+2");
    expect(cascade).toHaveAttribute("aria-expanded", "false");
    expect(getByRole("button", { name: /Updated demo-plugin/ })).toBeInTheDocument();
  });

  it("offers no cascade toggle when nothing followed, or when no handler is given", () => {
    const withoutFollowers = render(ActivityRow, {
      props: { record: record(), followerCount: 0, onopen: noop, oncascade: noop },
    });
    expect(withoutFollowers.queryByTestId("activity-followers")).toBeNull();

    const withoutHandler = render(ActivityRow, {
      props: { record: record(), followerCount: 3, onopen: noop },
    });
    expect(withoutHandler.queryByTestId("activity-followers")).toBeNull();
  });

  it("renders a v1 record that carries no origin, cause, or target", () => {
    const bare = {
      id: "old-1", ts: Date.now(), home: "/tmp/home-a", topic: "notification", action: "notified",
      actor: "system", impact: "info", source: "core-proxy", details: {}, text: "Switched provider",
    } as unknown as ActivityRecord;
    const { getByText } = render(ActivityRow, { props: { record: bare, onopen: noop } });
    expect(getByText("Switched provider")).toBeInTheDocument();
  });

  it("indents a hop by its depth and names where it ran", () => {
    const { container } = render(ActivityRow, {
      props: {
        record: record({ origin: { app: "claude", home: "/home/me/.claude", entry: "updater", pid: 1 } } as Partial<ActivityRecord>),
        follower: true,
        depth: 2,
        onopen: noop,
      },
    });
    const hop = container.querySelector("[data-testid='activity-hop']") as HTMLElement;
    expect(hop).toBeTruthy();
    expect(hop.style.getPropertyValue("--depth")).toBe("2");
    expect(container.textContent).toContain("updater");
  });

  it("marks a root row as no hop at all", () => {
    const { container } = render(ActivityRow, { props: { record: record(), onopen: noop } });
    expect(container.querySelector("[data-testid='activity-hop']")).toBeNull();
  });
});
