// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ActivityFilters from "./ActivityFilters.svelte";
import type { ActivityRecord } from "@forebay/shared";

function record(app: string, causeKind: string, actor: string): ActivityRecord {
  return {
    id: app + causeKind + actor,
    ts: Date.now(),
    home: "/tmp/h",
    topic: "plugin.installed",
    action: "updated",
    actor,
    impact: "info",
    source: "plugin-updater",
    details: {},
    text: "something",
    origin: { app, home: "/tmp/h" },
    cause: { kind: causeKind },
    trace: { id: "x" },
  } as ActivityRecord;
}

function baseProps(records: ActivityRecord[], onchange = (): void => {}) {
  return {
    records,
    impacts: new Set<never>(),
    app: "",
    cause: "",
    actor: "",
    source: "",
    topic: "",
    query: "",
    range: "24h",
    onchange,
  };
}

function optionValues(select: HTMLElement): string[] {
  return Array.from((select as HTMLSelectElement).options).map((o) => o.value);
}

describe("ActivityFilters", () => {
  it("offers exactly the apps, causes, and actors present in the records", () => {
    const { getByLabelText } = render(ActivityFilters, {
      props: baseProps([record("appone", "user", "user"), record("apptwo", "startup", "app")]),
    });

    expect(optionValues(getByLabelText("App"))).toEqual(["", "appone", "apptwo"]);
    expect(optionValues(getByLabelText("Cause"))).toEqual(["", "startup", "user"]);
    expect(optionValues(getByLabelText("Actor"))).toEqual(["", "app", "user"]);
  });

  it("omits a record's missing app, cause, or actor instead of offering an empty choice", () => {
    const bare = { ...record("appone", "user", "user"), origin: undefined, cause: undefined } as unknown as ActivityRecord;
    const { getByLabelText } = render(ActivityFilters, { props: baseProps([bare]) });

    expect(optionValues(getByLabelText("App"))).toEqual([""]);
    expect(optionValues(getByLabelText("Cause"))).toEqual([""]);
  });

  it("reports a chosen filter to its caller", async () => {
    const onchange = vi.fn();
    const { getByLabelText } = render(ActivityFilters, {
      props: baseProps([record("appone", "user", "user")], onchange),
    });

    await fireEvent.change(getByLabelText("App"), { target: { value: "appone" } });
    expect(onchange).toHaveBeenCalledWith({ app: "appone" });
  });

  it("reports an impact chip toggle as the new set, and a range as the new range", async () => {
    const onchange = vi.fn();
    const { getByRole, getByText } = render(ActivityFilters, {
      props: baseProps([record("appone", "user", "user")], onchange),
    });

    await fireEvent.click(getByText("error"));
    expect(onchange).toHaveBeenCalledWith({ impacts: new Set(["error"]) });

    await fireEvent.click(getByRole("button", { name: "7d" }));
    expect(onchange).toHaveBeenCalledWith({ range: "7d" });
  });
});
