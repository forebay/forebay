// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import type { Job, ActivityRecord } from "@forebay/shared";
import { resetDownloadsForTest, seedJobsForTest, seedTasksForTest } from "../downloads.js";

const cancelled: string[] = [];
let historyRecords: ActivityRecord[] = [];
// History only lists plugins that are still installed, so a test has to say what is.
let installedNames: string[] = ["config-ledger"];

vi.mock("../ipc.js", () => ({
  forebay: {
    jobsCancel: async (id: string) => { cancelled.push(id); return { ok: true, data: true }; },
    jobsClearFinished: async () => ({ ok: true, data: undefined }),
    jobsList: async () => ({ ok: true, data: [] }),
    activityRead: async () => ({ ok: true, data: { records: historyRecords } }),
    pluginsList: async () => ({
      ok: true,
      data: [{ home: { id: "claude", label: "Claude", dir: "/c", present: true, managesPlugins: true }, rows: installedNames.map((name) => ({ name, kind: "git", enabled: true, updateAvailable: false, description: "" })) }],
    }),
  },
}));

const { default: Downloads } = await import("./Downloads.svelte");

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1", kind: "install", plugin: "plugin-x", url: "u", home: "claude",
    status: "running", phase: "building", percent: 40, phases: [{ name: "downloading", ms: 3700 }], samples: [],
    queuedAt: 0, startedAt: 0, ...overrides,
  };
}

function record(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: "r1", ts: Date.now(), home: "/h", topic: "plugin.installed", action: "installed",
    actor: "system", impact: "notice", source: "plugin-updater",
    subject: { kind: "plugin", id: "config-ledger", label: "config-ledger" },
    details: { version: "f30d8a72ecd" }, text: "Installed config-ledger",
    origin: { app: "claude", home: "/h" }, cause: { kind: "user" }, trace: { id: "t" },
    outcome: "ok", durationMs: 14000, ...overrides,
  } as ActivityRecord;
}

describe("Downloads screen", () => {
  beforeEach(() => {
    resetDownloadsForTest();
    cancelled.length = 0;
    historyRecords = [];
    installedNames = ["config-ledger"];
  });

  it("says so plainly when nothing has been downloaded", async () => {
    render(Downloads);
    expect(await screen.findByText(/Nothing has been downloaded yet/)).toBeTruthy();
  });

  it("shows the active job with its phase trail and elapsed time", () => {
    seedJobsForTest([job()]);
    const { container, getByText } = render(Downloads);
    expect(container.querySelector("[data-testid='active-job']")).toBeTruthy();
    expect(getByText("Install plugin-x")).toBeTruthy();
    // A finished phase carries the time it really took, not a guess.
    expect(getByText("downloading")).toBeTruthy();
    expect(getByText("3.7s")).toBeTruthy();
    expect(container.querySelector(".stats")).toHaveTextContent("building");
  });

  it("lists queued jobs separately, with a count and a cancel each", () => {
    seedJobsForTest([
      job({ id: "a", status: "running" }),
      job({ id: "b", plugin: "second", status: "queued" }),
      job({ id: "c", plugin: "third", status: "queued" }),
    ]);
    const { container, getByText } = render(Downloads);
    expect(container.querySelector(".section .count")).toHaveTextContent("2");
    expect(container.querySelectorAll("[data-testid='queued-job']")).toHaveLength(2);
  });

  it("cancels the job a Cancel button belongs to", async () => {
    seedJobsForTest([job({ id: "j7", status: "running" })]);
    const { getByText } = render(Downloads);
    await fireEvent.click(getByText("Cancel"));
    expect(cancelled).toEqual(["j7"]);
  });

  it("reports a cancelling job without offering to cancel it again", () => {
    seedJobsForTest([job({ status: "cancelling" })]);
    const { getByText, queryByText } = render(Downloads);
    expect(getByText("Cancelling…")).toBeTruthy();
    expect(queryByText("Cancel")).toBeNull();
  });

  it("keeps a job that did not finish, with its reason and the home it targeted", async () => {
    seedJobsForTest([job({ id: "old", plugin: "failed-one", status: "failed", error: "disk full", endedAt: 1000 })]);
    historyRecords = [record()];
    const { container } = render(Downloads);
    // Recent shows a skeleton until the installed set resolves, so the rows are awaited.
    expect(await screen.findByText("config-ledger")).toBeTruthy();
    const failed = container.querySelector("[data-testid='failed-row']");
    expect(failed).toHaveTextContent("disk full");
    expect(failed).toHaveTextContent("Claude");
    // It appears up top and nowhere else, so Recent carries no second copy of it.
    expect(screen.getAllByText("Install failed-one")).toHaveLength(1);
    // One cell per grid column; a sixth would land in a track that does not exist.
    expect(failed?.children).toHaveLength(5);
  });

  // A finished job said the same thing twice: once as its own row, once as the plugin's history.
  it("drops a job from the screen once it has finished successfully", async () => {
    seedJobsForTest([job({ id: "ok", status: "done", endedAt: 2000 })]);
    historyRecords = [record()];
    const { container } = render(Downloads);
    await screen.findByText("config-ledger");
    expect(container.querySelector("[data-testid='failed-row']")).toBeNull();
    expect(container.textContent).not.toContain("Install plugin-x");
  });

  it("reports a cancelled job as cancelled rather than as a failure", async () => {
    seedJobsForTest([job({ id: "c", status: "cancelled", endedAt: 2000 })]);
    const { container } = render(Downloads);
    const row = container.querySelector("[data-testid='failed-row']");
    expect(row).toHaveTextContent("cancelled");
    expect(row?.querySelector(".dot.crit")).toBeNull();
  });

  // The clock used to count up forever, because a local task recorded no end time.
  it("freezes a local task's duration when it settles", async () => {
    seedTasksForTest([{ label: "Remove thing everywhere", status: "failed", error: "nope", startedAt: 1000, endedAt: 18_100 }]);
    const { container } = render(Downloads);
    expect(container.querySelector("[data-testid='failed-row'] .took")).toHaveTextContent("17.1s");
  });

  it("shows an update's version change from the history record", async () => {
    historyRecords = [record({ action: "updated", details: { fromVersion: "0bd46a3cd6c1", toVersion: "5ff48beff275" } })];
    render(Downloads);
    // The word between them is decoration, so each version is asserted on its own.
    expect(await screen.findByText("0bd46a3c")).toBeTruthy();
    expect(await screen.findByText("5ff48bef")).toBeTruthy();
  });

  it("says when a plugin was downloaded, with the exact stamp to hand", async () => {
    const ts = Date.now() - 3 * 60 * 60 * 1000;
    historyRecords = [record({ ts })];
    const { container } = render(Downloads);
    await screen.findByText("config-ledger");
    const when = container.querySelector("[data-testid='history-row'] .when");
    expect(when).toHaveTextContent("3h ago");
    expect(when?.getAttribute("title")).toBe(new Date(ts).toLocaleString());
  });

  it("gives a download older than a week a date rather than a day count", async () => {
    const ts = Date.now() - 40 * 24 * 60 * 60 * 1000;
    historyRecords = [record({ ts })];
    const { container } = render(Downloads);
    await screen.findByText("config-ledger");
    expect(container.querySelector("[data-testid='history-row'] .when"))
      .toHaveTextContent(new Date(ts).toLocaleDateString());
  });

  it("leaves out a record that names no plugin, like an updates-available notice", async () => {
    historyRecords = [
      record({ id: "notice", action: "updates_available", subject: undefined, details: { count: 1, names: ["x"] } }),
      record({ id: "real" }),
    ];
    const { container } = render(Downloads);
    await screen.findByText("config-ledger");
    expect(container.querySelectorAll("[data-testid='history-row']")).toHaveLength(1);
  });

  it("shows the transfer figures and a rate trace for an active job", () => {
    seedJobsForTest([job({
      status: "running", percent: 55, bytes: 5 * 1024 * 1024, bytesPerSecond: 3 * 1024 * 1024,
      samples: [{ ts: 1, bytesPerSecond: 1024 }, { ts: 2, bytesPerSecond: 2048 }],
    })]);
    const { getByText, getByTestId, container } = render(Downloads);
    expect(getByText("5.0 MB")).toBeTruthy();
    expect(container.querySelector(".stats")).toHaveTextContent("3.0 MB/s");
    expect(getByText("55%")).toBeTruthy();
    expect(getByTestId("total-rate")).toHaveTextContent("3.0 MB/s");
    // The trace is an svg path, not text.
    expect(container.querySelector("svg path.trace")).toBeTruthy();
  });

  it("shows an indeterminate bar and no figures before anything is reported", () => {
    seedJobsForTest([job({ status: "running", percent: -1, phases: [], samples: [] })]);
    const { container, getByText } = render(Downloads);
    expect(container.querySelector(".fill.indeterminate")).toBeTruthy();
    expect(getByText("--")).toBeTruthy();
    expect(container.querySelector("svg path.trace")).toBeNull();
  });

  it("keeps only the newest version of a plugin", async () => {
    historyRecords = [
      record({ id: "old", ts: 1000, details: { version: "aaaaaaaa11" } }),
      record({ id: "new", ts: 2000, details: { version: "bbbbbbbb22" } }),
    ];
    const { container } = render(Downloads);
    await screen.findByText("bbbbbbbb");
    // Both versions are real history, so both stay; the newest leads.
    const versions = [...container.querySelectorAll("[data-testid='history-row'] .to")].map((n) => n.textContent);
    expect(versions[0]).toBe("bbbbbbbb");
  });

  // Three near-identical rows for one plugin at one version is what made this a data dump.
  it("collapses one plugin at one version into a single row listing its homes", async () => {
    historyRecords = [
      record({ id: "a", ts: 3, origin: { app: "claude", home: "/c" } } as Partial<ActivityRecord>),
      record({ id: "b", ts: 2, origin: { app: "opencode", home: "/o" } } as Partial<ActivityRecord>),
      record({ id: "c", ts: 1, origin: { app: "forebay", home: "/k" } } as Partial<ActivityRecord>),
    ];
    const { container } = render(Downloads);
    await screen.findByText("config-ledger");
    const rows = container.querySelectorAll("[data-testid='history-row']");
    expect(rows).toHaveLength(1);
    expect([...rows[0].querySelectorAll(".chip")].map((c) => c.textContent)).toEqual(["Claude", "Opencode", "Forebay"]);
  });

  it("carries no column the log cannot fill", async () => {
    historyRecords = [record()];
    const { container } = render(Downloads);
    await screen.findByText("config-ledger");
    expect(container.querySelector("thead")).toBeNull();
    expect(container.textContent).not.toContain("Took");
  });

  it("leaves out history for a plugin that is no longer installed", async () => {
    installedNames = [];
    historyRecords = [record()];
    const { container } = render(Downloads);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelectorAll("[data-testid='history-row']")).toHaveLength(0);
  });
});
