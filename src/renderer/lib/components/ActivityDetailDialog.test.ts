// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ActivityDetailDialog from "./ActivityDetailDialog.svelte";
import type { ActivityRecord } from "@forebay/shared";

function record(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: "src-1",
    ts: Date.parse("2026-08-10T12:00:00Z"),
    home: "/tmp/home-a",
    topic: "plugin.installed",
    action: "updated",
    actor: "user",
    impact: "notice",
    source: "plugin-updater",
    subject: { kind: "plugin", id: "demo-plugin", label: "Demo Plugin" },
    details: {},
    text: "Updated demo-plugin",
    origin: { app: "someapp", home: "/tmp/home-a", entry: "updater" },
    cause: { kind: "user", surface: "plugins" },
    trace: { id: "trace-1" },
    ...overrides,
  } as ActivityRecord;
}

const noop = (): void => {};

describe("ActivityDetailDialog", () => {
  it("names the event, what it acted on, and where it ran", () => {
    const { getByTestId } = render(ActivityDetailDialog, {
      props: { record: record({ target: { app: "otherapp", home: "/tmp/home-b" } }), onClose: noop },
    });

    const dialog = getByTestId("activity-detail");
    expect(dialog).toHaveTextContent("Updated demo-plugin");
    expect(dialog).toHaveTextContent("plugin: Demo Plugin / demo-plugin");
    expect(dialog).toHaveTextContent("Someapp - updater - home-a");
    expect(dialog).toHaveTextContent("Otherapp - home-b");
    expect(dialog).toHaveTextContent("plugin-updater");
    expect(dialog).toHaveTextContent("trace-1");
  });

  it("states the outcome and how long it took", () => {
    const { getByTestId } = render(ActivityDetailDialog, {
      props: { record: record({ outcome: "failed", durationMs: 1500 }), onClose: noop },
    });
    expect(getByTestId("activity-detail")).toHaveTextContent("failed");
    expect(getByTestId("activity-detail")).toHaveTextContent("1.5s");
  });

  it("shows before and after values, and says redacted instead of a secret", () => {
    const { getByText, getAllByText } = render(ActivityDetailDialog, {
      props: {
        record: record({
          changes: [
            { key: "logging", from: true, to: false },
            { key: "apiKey", redacted: true },
          ],
        }),
        onClose: noop,
      },
    });
    expect(getByText("logging")).toBeInTheDocument();
    expect(getByText("true")).toBeInTheDocument();
    expect(getByText("false")).toBeInTheDocument();
    expect(getByText("apiKey")).toBeInTheDocument();
    expect(getAllByText(/redacted/i).length).toBeGreaterThan(0);
  });

  it("renders a missing value as unset rather than as the word undefined", () => {
    const { getByText, queryByText } = render(ActivityDetailDialog, {
      props: { record: record({ changes: [{ key: "logging", to: false }] }), onClose: noop },
    });
    expect(getByText("(unset)")).toBeInTheDocument();
    expect(queryByText("undefined")).toBeNull();
  });

  // The payload reads as named fields; the raw JSON is still reachable, just not the
  // first thing the dialog says.
  it("lists details as fields and keeps the raw payload behind a toggle", async () => {
    const { getByText, queryByTestId, getByRole, getByTestId } = render(ActivityDetailDialog, {
      props: { record: record({ details: { message: "Installed demo-plugin", url: "https://example/demo" } }), onClose: noop },
    });

    expect(getByText("message")).toBeInTheDocument();
    expect(getByText("Installed demo-plugin")).toBeInTheDocument();
    expect(queryByTestId("activity-details")).toBeNull();

    await fireEvent.click(getByRole("button", { name: /show raw payload/i }));
    expect(getByTestId("activity-details")).toHaveTextContent("https://example/demo");
  });

  it("shows no details section for an event that carries no payload", () => {
    const { queryByText } = render(ActivityDetailDialog, { props: { record: record(), onClose: noop } });
    expect(queryByText("Details")).toBeNull();
  });

  it("closes on Escape and from the close button", async () => {
    const onClose = vi.fn();
    const { getByRole } = render(ActivityDetailDialog, { props: { record: record(), onClose } });

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders a v1 record that carries no origin, cause, or trace", () => {
    const bare = {
      id: "old-1", ts: Date.now(), home: "/tmp/home-a", topic: "notification", action: "notified",
      actor: "system", impact: "info", source: "core-proxy", details: {}, text: "Switched provider",
    } as unknown as ActivityRecord;
    const { getByTestId } = render(ActivityDetailDialog, { props: { record: bare, onClose: noop } });
    expect(getByTestId("activity-detail")).toHaveTextContent("Switched provider");
  });
});
