// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import { router } from "../router.js";
import { seedTasksForTest, seedJobsForTest, openPanelForTest, resetDownloadsForTest, type DownloadRow } from "../downloads.js";
import type { Job } from "@forebay/shared";

const cancelled: string[] = [];
vi.mock("../ipc.js", () => ({
  forebay: {
    jobsCancel: async (id: string) => { cancelled.push(id); return { ok: true, data: true }; },
    jobsClearFinished: async () => ({ ok: true, data: undefined }),
    jobsList: async () => ({ ok: true, data: [] }),
  },
}));

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1", kind: "install", plugin: "plugin-x", url: "u", home: "claude",
    status: "running", phase: "", percent: -1, phases: [], samples: [], queuedAt: 0, ...overrides,
  };
}
import DownloadManager from "./DownloadManager.svelte";

type SeedTask = { id?: number; label?: string; home?: string; status?: DownloadRow["status"]; step?: string; percent?: number; error?: string; queuedAt?: number };

function task(overrides: SeedTask = {}): SeedTask {
  return { id: 1, label: "a", home: "/h", status: "installing", step: "", percent: -1, error: "", queuedAt: 0, ...overrides };
}

function seed(tasks: SeedTask[], open = false): void {
  seedTasksForTest(tasks);
  if (open) openPanelForTest();
}

describe("DownloadManager", () => {
  beforeEach(() => {
    resetDownloadsForTest();
    cancelled.length = 0;
  });

  it("hides the button when no tasks exist", () => {
    const { queryByRole } = render(DownloadManager);
    expect(queryByRole("button", { name: "Toggle download manager" })).toBeNull();
  });

  it("shows the button only while work is in flight", () => {
    seed([task({ status: "installing" })], false);
    expect(render(DownloadManager).getByRole("button", { name: "Toggle download manager" })).toBeTruthy();
  });

  it("hides the button once everything has finished", () => {
    seed([task({ status: "done" })], false);
    expect(render(DownloadManager).queryByRole("button", { name: "Toggle download manager" })).toBeNull();
  });

  it("badges the count of in-flight (pending + installing) tasks", () => {
    seed([
        task({ id: 1, status: "installing" }),
        task({ id: 2, status: "pending" }),
        task({ id: 3, status: "done" }),
      ], false);
    const { getByText } = render(DownloadManager);
    expect(getByText("2")).toBeTruthy();
  });

  it("hides the badge when no task is in flight", () => {
    seed([task({ status: "done" })], false);
    const { container } = render(DownloadManager);
    expect(container.querySelector(".badge")).toBeNull();
  });

  // Finished work belongs on the Downloads screen; the glance is for what is happening now.
  it("lists only live work, never finished work", () => {
    seed([task({ id: 1, label: "plugin-done", status: "done" }), task({ id: 2, label: "plugin-live", status: "installing" })], true);
    const { getByText, queryByText } = render(DownloadManager);
    expect(getByText("plugin-live")).toBeTruthy();
    expect(queryByText("plugin-done")).toBeNull();
  });

  it("carries no chart, only the figures", () => {
    seedJobsForTest([job({ status: "running", percent: 40, bytesPerSecond: 1024 * 1024, samples: [{ ts: 1, bytesPerSecond: 1024 }, { ts: 2, bytesPerSecond: 2048 }] })]);
    openPanelForTest();
    const { container, getByTestId } = render(DownloadManager);
    expect(container.querySelector("svg path.trace")).toBeNull();
    expect(getByTestId("glance-rate")).toHaveTextContent("1.0 MB/s");
  });

  it("toggles the panel open and lists label, home, and progress line", async () => {
    seed([task({ label: "installing plugin-x", home: "Claude Code", status: "installing" })], false);
    const { getByRole, getByText, queryByText } = render(DownloadManager);
    expect(queryByText("installing plugin-x")).toBeNull();

    await fireEvent.click(getByRole("button"));

    expect(getByText("installing plugin-x")).toBeTruthy();
    expect(getByText("Claude Code")).toBeTruthy();
    expect(getByText("Working…")).toBeTruthy();
  });

  it("shows the live step text while installing", () => {
    seed([task({ status: "installing", step: "building… (3/4)" })], true);
    const { getByText } = render(DownloadManager);
    expect(getByText("building… (3/4)")).toBeTruthy();
  });

  it("shows the stage and the percent as separate readouts", () => {
    seed([task({ status: "installing", step: "Downloading and building", percent: 40 })], true);
    const { getByText } = render(DownloadManager);
    expect(getByText("Downloading and building")).toBeTruthy();
    expect(getByText("40%")).toBeTruthy();
  });

  it("shows the live transfer rate for a job that reports one", () => {
    seedJobsForTest([job({ status: "running", percent: 30, bytesPerSecond: 2 * 1024 * 1024 })]);
    openPanelForTest();
    const { getByTestId } = render(DownloadManager);
    expect(getByTestId("glance-rate")).toHaveTextContent("2.0 MB/s");
  });

  it("renders the aggregate progress ring while work is in flight", () => {
    seed([task({ status: "installing", percent: 50 })], false);
    const { container } = render(DownloadManager);
    expect(container.querySelector(".ringfill")).toBeTruthy();
  });

  it("shows Queued for a pending task", () => {
    seed([task({ status: "pending" })], true);
    const { getByText } = render(DownloadManager);
    expect(getByText("Queued")).toBeTruthy();
  });

  // Who performed a download stopped being a distinction worth a badge once every plugin
  // install became one kind of sidecar job. Cancelling is what a row needs to offer instead.
  it("offers Cancel for a job that can still be cancelled, and not for a finished one", () => {
    seedJobsForTest([
      job({ id: "j1", status: "running" }),
      job({ id: "j2", plugin: "other", status: "done" }),
    ]);
    openPanelForTest();
    const { getAllByText } = render(DownloadManager);
    expect(getAllByText("Cancel")).toHaveLength(1);
  });

  it("cancels the job behind the row it was clicked on", async () => {
    seedJobsForTest([job({ id: "j9", status: "running" })]);
    openPanelForTest();
    const { getByText } = render(DownloadManager);
    await fireEvent.click(getByText("Cancel"));
    expect(cancelled).toEqual(["j9"]);
  });

  // Clearing and the full history moved to the Downloads screen; the popover is a glance
  // at live work with a way to get there.
  it("links to the screen for everything else", () => {
    seed([task({ status: "installing" })], true);
    expect(render(DownloadManager).getByRole("button", { name: "View all" })).toBeTruthy();
  });

  it("navigates to the Downloads screen and closes the popover", async () => {
    seed([task({ status: "installing" })], true);
    const { getByRole, container } = render(DownloadManager);
    await fireEvent.click(getByRole("button", { name: "View all" }));
    expect(get(router).screen).toBe("downloads");
    expect(container.querySelector(".panel")).toBeNull();
  });
});
