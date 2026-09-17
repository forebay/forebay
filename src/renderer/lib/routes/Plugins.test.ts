// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { stubForebay } from "../testing.js";
import { downloads, resetDownloadsForTest } from "../downloads.js";
import { router, navigate } from "../router.js";
import Plugins from "./Plugins.svelte";
import type { HomePlugins, PluginHome, Job } from "@forebay/shared";

function jobFor(home: string, plugin = "demo"): Job {
  return { id: `job-${home}-${plugin}`, kind: "install", plugin, url: "u", home, status: "done", phase: "", percent: 100, phases: [], samples: [], queuedAt: 0, endedAt: 1 };
}

// Jobs resolve as already done so the route's await of settlement does not hang a test.
function enqueueSpy() {
  return vi.fn(async (_kind: string, plugin: string, _url: string, home: string) => ({ ok: true as const, data: jobFor(home, plugin) }));
}

function home(id: string, label: string, overrides: Partial<PluginHome> = {}): PluginHome {
  return { id, label, dir: `/${id}`, present: true, managesPlugins: true, ...overrides };
}

const FOREBAY = home("forebay", "Forebay");
const CLAUDE = home("claude", "Claude Code");
const OPENCODE = home("opencode", "OpenCode");

function baseSections(): HomePlugins[] {
  return [
    { home: FOREBAY, rows: [] },
    { home: CLAUDE, rows: [{ name: "wakatime-sync", kind: "git", enabled: true, updateAvailable: false, description: "Tracks time" }] },
    { home: OPENCODE, rows: [] },
  ];
}

function baseCatalog() {
  return {
    entries: [
      { name: "wakatime-sync", url: "uw", kind: "plugin" as const, description: "cat desc", deprecated: false },
      { name: "demo", url: "u", kind: "plugin" as const, description: "Demo from catalog", deprecated: false },
    ],
    source: "gh" as const,
  };
}

describe("Plugins screen", () => {
  beforeEach(() => {
    resetDownloadsForTest();
  });

  it("renders a unified row per plugin with its description text", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);

    expect(await screen.findByText("wakatime-sync")).toBeInTheDocument();
    expect(screen.getByText("Tracks time")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("Demo from catalog")).toBeInTheDocument();
  });

  it("tags a row on the experimental channel and leaves an off-channel row untagged", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginVersionsAll: async () => ({
        ok: true,
        data: {
          "wakatime-sync": {
            claude: { kind: "git", label: "v1.0.0", updateState: "current", autoUpdate: true, onExperimental: true, experimentalAvailable: true },
          },
        },
      }),
    });
    render(Plugins);

    const onChannel = within(await screen.findByTestId("plugin-wakatime-sync"));
    expect(onChannel.getByText("experimental")).toBeInTheDocument();

    const offChannel = within(await screen.findByTestId("plugin-demo"));
    expect(offChannel.queryByText("experimental")).toBeNull();
  });

  it("checks every managed home for updates and reloads the rows afterwards", async () => {
    const checked: string[] = [];
    let listCalls = 0;
    stubForebay({
      pluginsList: async () => { listCalls += 1; return { ok: true, data: baseSections() }; },
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      updatesCheck: async (homeId: string) => {
        checked.push(homeId);
        return { ok: true, data: { checkedAt: "t", available: [] } };
      },
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");
    const before = listCalls;

    await fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    await waitFor(() => expect(checked).toEqual(["forebay", "claude", "opencode"]));
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
  });

  it("offers Update all only while something is actually behind", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");
    expect(screen.queryByRole("button", { name: "Update all" })).toBeNull();
  });

  it("offers the check as a refresh icon rather than a worded button", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");

    const button = screen.getByRole("button", { name: "Check for updates" });
    expect(button.textContent?.trim()).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("hides every update control when no home has an updater to run them", async () => {
    const noUpdater = [
      { home: home("forebay", "Forebay", { managesPlugins: false }), rows: [] },
      { home: home("claude", "Claude Code", { managesPlugins: false }), rows: [{ name: "wakatime-sync", kind: "git" as const, enabled: true, updateAvailable: true, description: "Tracks time" }] },
    ];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: noUpdater }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");

    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  // A plugin behind in a home nothing manages cannot be pulled, so "Update all" would be
  // a button that does nothing.
  it("offers Update all only when something behind sits in a home with an updater", async () => {
    const behindWhereUnmanaged = [
      { home: home("forebay", "Forebay"), rows: [] },
      { home: home("claude", "Claude Code", { managesPlugins: false }), rows: [{ name: "wakatime-sync", kind: "git" as const, enabled: true, updateAvailable: true, description: "Tracks time" }] },
    ];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: behindWhereUnmanaged }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");

    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update all" })).toBeNull();
  });

  it("narrows the list to what is behind, counting only homes that can update", async () => {
    const behind = baseSections();
    behind[1].rows[0].updateAvailable = true;
    stubForebay({
      pluginsList: async () => ({ ok: true, data: behind }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    await screen.findByText("demo");

    const chip = screen.getByRole("button", { name: /^Updates / });
    expect(chip).toHaveTextContent("Updates 1");
    await fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByText("demo")).toBeNull());
    expect(screen.getByText("wakatime-sync")).toBeTruthy();
  });

  it("offers no update filter matches when nothing is behind", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");
    expect(screen.getByRole("button", { name: /^Updates / })).toHaveTextContent("Updates 0");
  });

  it("checks only the homes that actually have an updater", async () => {
    const mixed = [
      { home: home("forebay", "Forebay", { managesPlugins: false }), rows: [] },
      { home: home("claude", "Claude Code"), rows: [{ name: "wakatime-sync", kind: "git" as const, enabled: true, updateAvailable: false, description: "Tracks time" }] },
    ];
    const checked: string[] = [];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: mixed }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      updatesCheck: async (homeId: string) => {
        checked.push(homeId);
        return { ok: true, data: { checkedAt: "t", available: [] } };
      },
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");

    await fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(checked).toEqual(["claude"]));
  });

  it("updates every managed home when something is behind, then reloads", async () => {
    const behind = baseSections();
    behind[1].rows[0].updateAvailable = true;
    const updated: string[] = [];
    stubForebay({
      pluginsList: async () => ({ ok: true, data: behind }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      updatesAll: async (homeId: string) => {
        updated.push(homeId);
        return { ok: true, data: { updated: [], skipped: [], failed: [], checkedAt: "t" } };
      },
    });
    render(Plugins);
    await screen.findByText("wakatime-sync");

    await fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
    await waitFor(() => expect(updated).toEqual(["forebay", "claude", "opencode"]));
  });

  it("clicking the star button favorites a plugin locally and mirrors the star to GitHub, without opening the detail view", async () => {
    const favoritesToggle = vi.fn(async (name: string) => ({ ok: true, data: [name] }) as const);
    const githubSetStar = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      githubStatus: async () => ({ ok: true, data: { source: "config", connected: true, login: "octocat", name: null, avatarUrl: null, ghCliDetected: false, ghCli: null, accounts: [{ login: "octocat", name: null, avatarUrl: null }], activeLogin: "octocat", forebayRepoUrl: "https://github.com/forebay/forebay", forebayStarred: null } }),
      favoritesToggle,
      githubSetStar,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-demo"));
    await fireEvent.click(row.getByRole("button", { name: "Favorite" }));

    await waitFor(() => expect(favoritesToggle).toHaveBeenCalledWith("demo"));
    await waitFor(() => expect(githubSetStar).toHaveBeenCalledWith("u", true));
    // The row's own open button, not the favorite button, is what opens the detail view.
    expect(screen.queryByText("Every provider, proxy, and plugin")).toBeNull();
  });

  it("prompts to connect GitHub instead of favoriting when starring while not connected", async () => {
    const favoritesToggle = vi.fn(async (name: string) => ({ ok: true, data: [name] }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      favoritesToggle,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-demo"));
    await fireEvent.click(row.getByRole("button", { name: "Favorite" }));

    await screen.findByRole("dialog", { name: "Add GitHub account" });
    expect(favoritesToggle).not.toHaveBeenCalled();
  });

  it("the Favorites chip filters to favorited plugins and a favorited plugin sorts to the top", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      favoritesList: async () => ({ ok: true, data: ["demo"] }),
    });
    render(Plugins);

    await screen.findByTestId("plugin-demo");
    const rowsBefore = screen.getAllByTestId(/^plugin-/);
    expect(rowsBefore[0]).toHaveAttribute("data-testid", "plugin-demo");

    await fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));
    expect(screen.getByTestId("plugin-demo")).toBeInTheDocument();
    expect(screen.queryByTestId("plugin-wakatime-sync")).not.toBeInTheDocument();
  });

  it("shows claude filled and opencode outline for a plugin installed only on claude", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    const claudePill = row.getByTitle("Claude Code");
    const opencodePill = row.getByTitle("OpenCode");
    expect(claudePill.classList.contains("on")).toBe(true);
    expect(opencodePill.classList.contains("na")).toBe(true);
  });

  it("Install (primary) on an uninstalled catalog plugin queues a job per applicable home", async () => {
    const jobsEnqueue = enqueueSpy();
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      jobsEnqueue,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-demo"));
    await fireEvent.click(row.getByRole("button", { name: "Install everywhere" }));

    // One job per home so each home shows its own progress and can be cancelled alone.
    await waitFor(() => expect(jobsEnqueue).toHaveBeenCalledWith("install", "demo", "u", "claude"));
    await waitFor(() => expect(jobsEnqueue).toHaveBeenCalledWith("install", "demo", "u", "opencode"));
  });

  it("clicking an outline pill on an installed plugin queues a job for that one home", async () => {
    const jobsEnqueue = enqueueSpy();
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      jobsEnqueue,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByTitle("OpenCode"));

    await waitFor(() => expect(jobsEnqueue).toHaveBeenCalledWith("install", "wakatime-sync", "uw", "opencode"));
  });

  it("reports a home whose job could not even be queued", async () => {
    const jobsEnqueue = vi.fn(async (_kind: string, _plugin: string, _url: string, home: string) =>
      home === "opencode" ? ({ ok: false, error: "disk full" } as const) : ({ ok: true, data: jobFor(home) } as const),
    );
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      jobsEnqueue,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-demo"));
    await fireEvent.click(row.getByRole("button", { name: "Install everywhere" }));

    await waitFor(() => expect(jobsEnqueue).toHaveBeenCalledWith("install", "demo", "u", "opencode"));
  });

  it("adding a plugin-kind repo by URL installs to the applicable host-app homes, not forebay", async () => {
    const jobsEnqueue = enqueueSpy();
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      jobsEnqueue,
    });
    render(Plugins);

    await fireEvent.click(await screen.findByRole("button", { name: "+ Add from URL" }));
    const dialog = within(screen.getByRole("dialog"));
    await fireEvent.input(dialog.getByPlaceholderText("owner/repo or GitHub URL"), {
      target: { value: "https://github.com/forebay/some-plugin" },
    });
    await fireEvent.click(dialog.getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(jobsEnqueue).toHaveBeenCalledWith("install", "some-plugin", "https://github.com/forebay/some-plugin", "claude"),
    );
  });

  it("opens the Add dialog on mount when deep-linked with an add param", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    router.set({ screen: "plugins", params: { add: "1" } });
    render(Plugins);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the display name as the title and the repo name as a subtitle", async () => {
    stubForebay({
      pluginsList: async () => ({
        ok: true,
        data: [
          { home: FOREBAY, rows: [] },
          { home: CLAUDE, rows: [{ name: "wakatime-sync", kind: "git", enabled: true, updateAvailable: false, description: "d", displayName: "WakaTime", icon: "" }] },
          { home: OPENCODE, rows: [] },
        ],
      }),
      catalogList: async () => ({ ok: true, data: { entries: [], source: "gh" } }),
    });
    const { findByText, getByText } = render(Plugins);
    expect(await findByText("WakaTime")).toBeInTheDocument();
    expect(getByText("wakatime-sync")).toBeInTheDocument();
  });

  it("renders repo topic chips on a plugin row", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: { entries: [{ name: "wakatime-sync", url: "u", kind: "plugin", description: "Tracks time", deprecated: false, topics: ["forebay", "plugin", "typescript"] }], source: "gh" } }),
    });
    const { findAllByTestId } = render(Plugins);
    const chips = await findAllByTestId("topic");
    expect(chips.map((c) => c.textContent)).toEqual(expect.arrayContaining(["forebay", "plugin", "typescript"]));
  });

  it("offers install into every home, including one with no updater yet", async () => {
    stubForebay({
      pluginsList: async () => ({
        ok: true,
        data: [
          { home: FOREBAY, rows: [] },
          { home: home("claude", "Claude Code", { managesPlugins: false }), rows: [] },
          { home: home("opencode", "OpenCode", { managesPlugins: true }), rows: [] },
        ],
      }),
      catalogList: async () => ({
        ok: true,
        data: {
          entries: [
            { name: "wakatime-sync", url: "u", kind: "plugin" as const, description: "normal", deprecated: false, topics: [] },
            { name: "plugin-updater", url: "u", kind: "plugin" as const, description: "engine", deprecated: false, topics: [] },
          ],
          source: "gh" as const,
        },
      }),
      enginesList: async () => ({ ok: true, data: [{ id: "plugin-updater", capability: "plugin-management", url: "https://github.com/forebay/plugin-updater", homes: {} }] }),
    });
    render(Plugins);

    // The updater arrives as part of the install now, so a home without it is still a
    // valid target: an ordinary plugin's pill offers the install just like the engine's.
    const normal = within(await screen.findByTestId("plugin-wakatime-sync"));
    expect(normal.getByLabelText(/Claude Code: click to install/)).toBeInTheDocument();
    const engine = within(await screen.findByTestId("plugin-plugin-updater"));
    expect(engine.getByLabelText(/Claude Code: click to install/)).toBeInTheDocument();
  });

  it("offers an Engines filter and shows only engine rows when active", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "plugin-updater", url: "u", kind: "plugin", description: "engine", deprecated: false, topics: [] },
        { name: "wakatime-sync", url: "u", kind: "plugin", description: "normal", deprecated: false, topics: [] },
      ], source: "anonymous" } }),
      enginesList: async () => ({ ok: true, data: [
        { id: "plugin-updater", capability: "plugin-management", url: "https://github.com/forebay/plugin-updater", homes: { claude: { installed: true, enabled: true } } },
      ] }),
    });
    const { getByRole, getByText, queryByText, container } = render(Plugins);
    await waitFor(() => expect(getByText("wakatime-sync")).toBeTruthy());
    const filters = within(container.querySelector(".filters")!);
    await fireEvent.click(filters.getByRole("button", { name: /Engines/ }));
    await waitFor(() => expect(queryByText("wakatime-sync")).toBeNull());
    expect(getByText("plugin-updater")).toBeTruthy();
  });


  it("keeps remove controls in the detail pane for a non-mandatory plugin", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByTitle("View wakatime-sync"));
    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "More install options" }));
    expect(dialog.getByRole("button", { name: "Remove everywhere" })).toBeInTheDocument();
    await fireEvent.click(dialog.getByRole("button", { name: "Availability" }));
    expect(dialog.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("names the single remaining home in the install button", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    // wakatime-sync is installed in Claude only, so the one remaining home is named.
    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    expect(row.getByRole("button", { name: "Install in OpenCode" })).toBeInTheDocument();
  });

  it("makes the header split-button Remove everywhere when installed in every applicable home", async () => {
    stubForebay({
      pluginsList: async () => ({
        ok: true,
        data: [
          { home: FOREBAY, rows: [] },
          { home: CLAUDE, rows: [{ name: "wakatime-sync", kind: "git", enabled: true, updateAvailable: false, description: "" }] },
          { home: OPENCODE, rows: [{ name: "wakatime-sync", kind: "git", enabled: true, updateAvailable: false, description: "" }] },
        ],
      }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByTitle("View wakatime-sync"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Remove everywhere" })).toBeInTheDocument();
  });

  it("updates a home and toggles its auto-update from the detail's Availability tab", async () => {
    const pluginsSetAutoUpdate = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    const jobsEnqueue = enqueueSpy();
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginVersions: async () => ({
        ok: true,
        data: {
          claude: {
            kind: "git",
            label: "v1.0.0",
            updateState: "behind",
            autoUpdate: true,
            onExperimental: false,
            experimentalAvailable: null,
          },
        },
      }),
      pluginsSetAutoUpdate,
      jobsEnqueue,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByTitle("View wakatime-sync"));
    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Availability" }));

    await fireEvent.click(dialog.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(jobsEnqueue).toHaveBeenCalledWith("update", "wakatime-sync", expect.any(String), "claude"));

    await fireEvent.click(dialog.getByRole("button", { name: "Auto-update Claude Code off" }));
    await waitFor(() => expect(pluginsSetAutoUpdate).toHaveBeenCalledWith("claude", "wakatime-sync", false));
  });

  // A rejected channel write must stop before the update job, or the clone would end up
  // running the branch the write just failed to set.
  it("does not enqueue an update when the channel write fails", async () => {
    const pluginsSetChannel = vi.fn(async () => ({ ok: false, error: "boom" }) as const);
    const jobsEnqueue = enqueueSpy();
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginVersions: async () => ({
        ok: true,
        data: {
          claude: {
            kind: "git",
            label: "v1.0.0",
            updateState: "current",
            autoUpdate: true,
            onExperimental: false,
            experimentalAvailable: true,
          },
        },
      }),
      pluginsSetChannel,
      jobsEnqueue,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByTitle("View wakatime-sync"));
    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Availability" }));

    await fireEvent.click(dialog.getByRole("button", { name: "Experimental channel for Claude Code" }));
    await waitFor(() => expect(pluginsSetChannel).toHaveBeenCalledWith("claude", "wakatime-sync", "experimental"));
    expect(jobsEnqueue).not.toHaveBeenCalled();
  });

  it("confirms before removing a plugin everywhere", async () => {
    const pluginsRemoveEverywhere = vi.fn(async () => ({ ok: true, data: { outcomes: [] } }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginsRemoveEverywhere,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByRole("button", { name: "More install options" }));
    await fireEvent.click(row.getByRole("button", { name: "Remove everywhere" }));

    expect(pluginsRemoveEverywhere).not.toHaveBeenCalled();
    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Remove everywhere" }));

    await waitFor(() => expect(pluginsRemoveEverywhere).toHaveBeenCalledWith("wakatime-sync"));
  });

  // Reinstalling is the common case, so keeping a plugin's settings is the default and
  // deleting them is a deliberate extra tick.
  it("offers to delete the plugin's data on uninstall, off by default", async () => {
    const pluginsRemoveData = vi.fn(async () => ({ ok: true, data: [] }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginsRemoveEverywhere: async () => ({ ok: true, data: { outcomes: [] } }),
      pluginsData: async () => ({
        ok: true,
        data: [{
          home: { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true },
          entries: [{ path: "config/wakatime-sync.json", bytes: 120 }, { path: "logs/2026-08-11/wakatime-sync-09-00-00.log", bytes: 400 }],
        }],
      }),
      pluginsRemoveData,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByRole("button", { name: "More install options" }));
    await fireEvent.click(row.getByRole("button", { name: "Remove everywhere" }));

    const dialog = within(await screen.findByRole("dialog"));
    const checkbox = dialog.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    // The offer names what it would delete rather than asking about "config data" abstractly.
    expect(dialog.getByText("2 files (520 B) in Claude Code")).toBeInTheDocument();

    await fireEvent.click(dialog.getByRole("button", { name: "Remove everywhere" }));
    await waitFor(() => expect(pluginsRemoveData).not.toHaveBeenCalled());
  });

  it("deletes exactly the listed paths once the box is ticked", async () => {
    const pluginsRemoveData = vi.fn(async () => ({ ok: true, data: [] }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginsRemoveEverywhere: async () => ({ ok: true, data: { outcomes: [] } }),
      pluginsData: async () => ({
        ok: true,
        data: [{
          home: { id: "claude", label: "Claude Code", dir: "/c", present: true, managesPlugins: true },
          entries: [{ path: "config/wakatime-sync.json", bytes: 120 }],
        }],
      }),
      pluginsRemoveData,
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByRole("button", { name: "More install options" }));
    await fireEvent.click(row.getByRole("button", { name: "Remove everywhere" }));

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("checkbox"));
    await fireEvent.click(dialog.getByRole("button", { name: "Remove everywhere" }));

    await waitFor(() => expect(pluginsRemoveData).toHaveBeenCalledWith("claude", ["config/wakatime-sync.json"]));
  });

  it("does not offer the checkbox for a plugin that left nothing behind", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginsRemoveEverywhere: async () => ({ ok: true, data: { outcomes: [] } }),
      pluginsData: async () => ({ ok: true, data: [] }),
    });
    render(Plugins);

    const row = within(await screen.findByTestId("plugin-wakatime-sync"));
    await fireEvent.click(row.getByRole("button", { name: "More install options" }));
    await fireEvent.click(row.getByRole("button", { name: "Remove everywhere" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByRole("checkbox")).toBeNull();
  });

  it("shows a Clear filters empty state when the search matches nothing, and clicking it restores the rows", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);

    expect(await screen.findByText("wakatime-sync")).toBeInTheDocument();

    await fireEvent.input(screen.getByPlaceholderText("Search plugins…"), { target: { value: "nonexistent-plugin-xyz" } });

    const clearButton = await screen.findByRole("button", { name: "Clear filters" });
    expect(screen.getByText("No plugins match your filters.")).toBeInTheDocument();
    expect(screen.queryByText("wakatime-sync")).toBeNull();

    await fireEvent.click(clearButton);

    await waitFor(() => expect(screen.getByText("wakatime-sync")).toBeInTheDocument());
    expect(screen.queryByText("No plugins match your filters.")).toBeNull();
  });

  it("renders a view toggle and starts in grid mode when that is the stored preference, showing plugin cards", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      getConfig: async () => ({ ok: true, data: "grid" }),
    });
    render(Plugins);

    expect(await screen.findByRole("button", { name: "Grid view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List view" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("plugins-grid")).toBeInTheDocument());
    const grid = within(screen.getByTestId("plugins-grid"));
    expect(grid.getByText("wakatime-sync")).toBeInTheDocument();
    expect(grid.getByText("Tracks time")).toBeInTheDocument();
  });

  it("switches back to list view and persists the choice", async () => {
    const setConfig = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      getConfig: async () => ({ ok: true, data: "grid" }),
      setConfig,
    });
    render(Plugins);

    await waitFor(() => expect(screen.getByTestId("plugins-grid")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("button", { name: "List view" }));

    await waitFor(() => expect(screen.getByTestId("plugins-list")).toBeInTheDocument());
    expect(screen.queryByTestId("plugins-grid")).toBeNull();
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith("forebay", "viewMode.plugins", "list"));
  });

  it("keeps the Engines filter and grid mode working together", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "plugin-updater", url: "u", kind: "plugin", description: "engine", deprecated: false, topics: [] },
        { name: "wakatime-sync", url: "u", kind: "plugin", description: "normal", deprecated: false, topics: [] },
      ], source: "anonymous" } }),
      enginesList: async () => ({ ok: true, data: [
        { id: "plugin-updater", capability: "plugin-management", url: "https://github.com/forebay/plugin-updater", homes: { claude: { installed: true, enabled: true } } },
      ] }),
      getConfig: async () => ({ ok: true, data: "grid" }),
    });
    render(Plugins);

    await waitFor(() => expect(screen.getByTestId("plugins-grid")).toBeInTheDocument());
    expect(await screen.findByTestId("plugin-plugin-updater")).toBeInTheDocument();

    const filters = within(document.querySelector(".filters")!);
    await fireEvent.click(filters.getByRole("button", { name: /Engines/ }));
    await waitFor(() => expect(screen.queryByText("wakatime-sync")).toBeNull());
    expect(screen.getByText("plugin-updater")).toBeInTheDocument();
  });

  it("shows a loading skeleton before plugins resolve, then content", async () => {
    let resolvePlugins!: (v: { ok: true; data: HomePlugins[] }) => void;
    const pending = new Promise<{ ok: true; data: HomePlugins[] }>((r) => (resolvePlugins = r));
    stubForebay({
      pluginsList: () => pending,
      catalogList: async () => ({ ok: true, data: { entries: [], source: "anonymous" } }),
    });
    const { getAllByTestId, queryAllByTestId } = render(Plugins);

    expect(getAllByTestId("skeleton").length).toBeGreaterThan(0);
    resolvePlugins({ ok: true, data: baseSections() });
    await waitFor(() => expect(queryAllByTestId("skeleton").length).toBe(0));
  });

  it("opens on the plugin filter by default, hiding non-plugin repos", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "acme-provider", url: "u", kind: "provider" as const, description: "a provider", deprecated: false, topics: [] },
        { name: "demo", url: "u", kind: "plugin" as const, description: "a plugin", deprecated: false, topics: [] },
      ], source: "gh" as const } }),
    });
    render(Plugins);
    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.queryByText("acme-provider")).toBeNull();
  });

  it("preselects the provider filter when opened via an Add-provider deep link", async () => {
    navigate("plugins", { kind: "provider" });
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "acme-provider", url: "u", kind: "provider" as const, description: "a provider", deprecated: false, topics: [] },
        { name: "demo", url: "u", kind: "plugin" as const, description: "a plugin", deprecated: false, topics: [] },
      ], source: "gh" as const } }),
    });
    render(Plugins);
    expect(await screen.findByText("acme-provider")).toBeInTheDocument();
    expect(screen.queryByText("demo")).toBeNull();
  });

  it("shows loaders under the Loaders filter, hidden by default", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "opencode-loader", url: "u", kind: "loader" as const, description: "a loader", deprecated: false, topics: [] },
        { name: "demo", url: "u", kind: "plugin" as const, description: "a plugin", deprecated: false, topics: [] },
      ], source: "gh" as const } }),
    });
    const { getByText, queryByText, container } = render(Plugins);
    await waitFor(() => expect(getByText("demo")).toBeTruthy());
    expect(queryByText("opencode-loader")).toBeNull();
    const filters = within(container.querySelector(".filters")!);
    await fireEvent.click(filters.getByRole("button", { name: /Loaders/ }));
    await waitFor(() => expect(getByText("opencode-loader")).toBeTruthy());
    expect(queryByText("demo")).toBeNull();
  });

  // An archived repo is still installable, which is the whole point of listing it, but it is
  // not what you are normally shopping for. It stays hidden until asked for, and the answer is
  // remembered so it need only be asked once.
  it("keeps archived repos out of the list until the Deprecated filter is turned on", async () => {
    const setConfig = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "demo", url: "u", kind: "plugin" as const, description: "a plugin", deprecated: false, topics: [] },
        { name: "metric-dashboard", url: "u", kind: "plugin" as const, description: "an archived one", deprecated: true, topics: [] },
      ], source: "gh" as const } }),
      setConfig,
    });
    const { getByText, queryByText, container } = render(Plugins);
    await waitFor(() => expect(getByText("demo")).toBeTruthy());
    expect(queryByText("metric-dashboard")).toBeNull();

    const filters = within(container.querySelector(".filters")!);
    await fireEvent.click(filters.getByRole("button", { name: /Deprecated 1/ }));

    await waitFor(() => expect(getByText("metric-dashboard")).toBeTruthy());
    expect(getByText("deprecated")).toBeTruthy();
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith("forebay", "showDeprecated", true));
  });

  it("starts with archived repos listed when that was the stored answer", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "metric-dashboard", url: "u", kind: "plugin" as const, description: "an archived one", deprecated: true, topics: [] },
      ], source: "gh" as const } }),
      getConfig: async () => ({ ok: true, data: true }) as const,
    });
    render(Plugins);
    expect(await screen.findByText("metric-dashboard")).toBeInTheDocument();
  });

  // Hiding one that is already on disk would leave no way to remove it.
  it("lists an archived repo that is installed even with the filter off", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: [
        { home: CLAUDE, rows: [{ name: "metric-dashboard", kind: "git" as const, enabled: true, updateAvailable: false, description: "on disk" }] },
      ] }),
      catalogList: async () => ({ ok: true, data: { entries: [
        { name: "metric-dashboard", url: "u", kind: "plugin" as const, description: "an archived one", deprecated: true, topics: [] },
      ], source: "gh" as const } }),
    });
    render(Plugins);
    expect(await screen.findByText("metric-dashboard")).toBeInTheDocument();
  });

  // Reading every home takes long enough that the screen used to sit on a skeleton for
  // seconds. The last list is drawn first so there is something real on screen immediately.
  it("paints the cached list while the real one is still being read", async () => {
    let releaseLive: (value: { ok: true; data: HomePlugins[] }) => void = () => {};
    const live = new Promise<{ ok: true; data: HomePlugins[] }>((resolve) => { releaseLive = resolve; });
    stubForebay({
      pluginsListCached: async () => ({ ok: true, data: [
        { home: CLAUDE, rows: [{ name: "from-cache", kind: "git" as const, enabled: true, updateAvailable: false, description: "cached" }] },
      ] }),
      catalogListCached: async () => ({ ok: true, data: { entries: [], source: "gh" as const, org: "forebay", rateLimited: false } }),
      pluginsList: () => live,
      catalogList: async () => ({ ok: true, data: { entries: [], source: "gh" as const } }),
    });
    render(Plugins);

    expect(await screen.findByText("from-cache")).toBeInTheDocument();

    releaseLive({ ok: true, data: [
      { home: CLAUDE, rows: [{ name: "from-disk", kind: "git", enabled: true, updateAvailable: false, description: "live" }] },
    ] });

    expect(await screen.findByText("from-disk")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("from-cache")).toBeNull());
  });

  // Painting the default view and swapping to the stored one a frame later is a visible flash
  // of the wrong screen, so the stored view is part of the first paint.
  it("waits for the stored view before painting anything", async () => {
    let releaseConfig: (value: { ok: true; data: string }) => void = () => {};
    const config = new Promise<{ ok: true; data: string }>((resolve) => { releaseConfig = resolve; });
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      getConfig: () => config,
    });
    render(Plugins);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("plugins-list")).toBeNull();
    expect(screen.queryByTestId("plugins-grid")).toBeNull();

    releaseConfig({ ok: true, data: "grid" });

    expect(await screen.findByTestId("plugins-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("plugins-list")).toBeNull();
  });

  it("leaves the skeleton up when nothing is cached yet", async () => {
    stubForebay({
      pluginsListCached: async () => ({ ok: true, data: [] }),
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    render(Plugins);
    expect(await screen.findByText("wakatime-sync")).toBeInTheDocument();
  });

  // A head start built from the plugin list alone drew a list that then grew and reordered as
  // the catalog landed, which is exactly the half-loaded state the cache is meant to avoid.
  it("waits for the full row set when only the plugin list is cached", async () => {
    let releaseCatalog: (value: { ok: true; data: { entries: []; source: "gh" } }) => void = () => {};
    const catalogPending = new Promise<{ ok: true; data: { entries: []; source: "gh" } }>((resolve) => { releaseCatalog = resolve; });
    stubForebay({
      pluginsListCached: async () => ({ ok: true, data: baseSections() }),
      catalogListCached: async () => ({ ok: true, data: null }),
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: () => catalogPending,
    });
    render(Plugins);

    await waitFor(() => expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0));
    expect(screen.queryByText("wakatime-sync")).toBeNull();

    releaseCatalog({ ok: true, data: { entries: [], source: "gh" } });

    expect(await screen.findByText("wakatime-sync")).toBeInTheDocument();
  });

  // A row on the Downloads screen links here with the plugin named, so it must open.
  it("opens the named plugin when arrived at with a plugin param", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
    });
    navigate("plugins", { plugin: "wakatime-sync" });
    render(Plugins);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("wakatime-sync")).toBeTruthy();
  });

  function multiSourceCatalog() {
    return {
      ...baseCatalog(),
      entries: [
        { name: "wakatime-sync", url: "uw", kind: "plugin" as const, description: "from the org", deprecated: false, sourceId: "forebay" },
        { name: "demo-plugin", url: "ud", kind: "plugin" as const, description: "from the demo marketplace", deprecated: false, sourceId: "demo" },
      ],
      sources: [
        { id: "forebay", label: "forebay", type: "github-org" as const, ok: true, entryCount: 1 },
        { id: "demo", label: "Demo", type: "local" as const, ok: true, entryCount: 1 },
      ],
    };
  }

  // With one marketplace the screen must look exactly as it did before this existed.
  it("offers no source filter while only one marketplace is configured", async () => {
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: baseCatalog() }) });
    render(Plugins);
    await screen.findByText("wakatime-sync");
    expect(screen.queryByTestId("source-filters")).toBeNull();
  });

  it("browses marketplaces combined by default and one at a time when asked", async () => {
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: multiSourceCatalog() }) });
    render(Plugins);
    await screen.findByTestId("source-filters");

    expect(await screen.findByText("wakatime-sync")).toBeTruthy();
    expect(screen.getByText("demo-plugin")).toBeTruthy();

    await fireEvent.click(within(screen.getByTestId("source-filters")).getByText("Demo 1"));

    await waitFor(() => expect(screen.queryByText("wakatime-sync")).toBeNull());
    expect(screen.getByText("demo-plugin")).toBeTruthy();
  });

  // A marketplace being down must not read as an empty catalog, which is what a
  // single-source scan could not distinguish.
  it("still lists a healthy marketplace's entries and names the one that failed", async () => {
    const withFailure = {
      ...multiSourceCatalog(),
      entries: [multiSourceCatalog().entries[0]],
      sources: [
        { id: "forebay", label: "forebay", type: "github-org" as const, ok: true, entryCount: 1 },
        { id: "acme", label: "Acme", type: "manifest" as const, ok: false, entryCount: 0, error: "http 404" },
      ],
    };
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: withFailure }) });
    render(Plugins);

    expect(await screen.findByText("wakatime-sync")).toBeTruthy();
    expect(await screen.findByText(/Could not read the Acme marketplace: http 404/)).toBeTruthy();
  });

  // The higher-priority copy is the one listed, but the user has to be told the other exists.
  it("warns which entries a lower-priority marketplace lost, and to whom", async () => {
    const withShadow = {
      ...multiSourceCatalog(),
      sources: [
        { id: "forebay", label: "forebay", type: "github-org" as const, ok: true, entryCount: 1 },
        { id: "demo", label: "Demo", type: "local" as const, ok: true, entryCount: 1, shadowed: [{ name: "wakatime-sync", by: "forebay" }] },
      ],
    };
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: withShadow }) });
    render(Plugins);

    const warning = await screen.findByTestId("source-shadowed");
    expect(warning.textContent).toContain("Demo also publishes wakatime-sync (listed by forebay)");
    expect(warning.textContent).toContain("copy is hidden");
  });

  // A plugin declares a category by MATCH, so a translator published later joins it with no
  // change to the plugin that declared it.
  it("offers a category an installed plugin contributed, filtering by its match", async () => {
    const withTranslators = {
      ...baseCatalog(),
      entries: [
        { name: "wakatime-sync", url: "uw", kind: "plugin" as const, description: "", deprecated: false, topics: ["plugin"] },
        { name: "openai-translator", url: "uo", kind: "translator" as const, description: "", deprecated: false, topics: ["vendor-translator"] },
      ],
      contributions: [{ id: "translators", label: "Translators", match: { topics: ["vendor-translator"] }, contributedBy: "custom-auth" }],
    };
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: withTranslators }) });
    render(Plugins);

    const row = await screen.findByTestId("contributed-filters");
    await fireEvent.click(within(row).getByText("Translators 1"));

    expect(await screen.findByText("openai-translator")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("wakatime-sync")).toBeNull());
  });

  it("offers no contributed categories when no plugin declares one", async () => {
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: baseCatalog() }) });
    render(Plugins);
    await screen.findByText("wakatime-sync");
    expect(screen.queryByTestId("contributed-filters")).toBeNull();
  });

  it("shows no shadowing warning when no marketplace lost an entry", async () => {
    stubForebay({ pluginsList: async () => ({ ok: true, data: baseSections() }), catalogList: async () => ({ ok: true, data: multiSourceCatalog() }) });
    render(Plugins);
    await screen.findByTestId("source-filters");
    expect(screen.queryByTestId("source-shadowed")).toBeNull();
  });

  it("warns about a quarantined plugin, naming the home, the reason and the fix", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginQuarantine: async () => ({
        ok: true,
        data: [{ homeId: "app-a-id", homeLabel: "App A", pluginId: "historian", detail: "activate threw", fix: "fix the error activate threw, or disable the plugin" }],
      }),
    });
    render(Plugins);

    expect(await screen.findByText("historian is not running in App A")).toBeInTheDocument();
    expect(screen.getByText("activate threw")).toBeInTheDocument();
    expect(screen.getByText("fix the error activate threw, or disable the plugin")).toBeInTheDocument();
  });

  it("shows no quarantine notice when every plugin loaded", async () => {
    stubForebay({
      pluginsList: async () => ({ ok: true, data: baseSections() }),
      catalogList: async () => ({ ok: true, data: baseCatalog() }),
      pluginQuarantine: async () => ({ ok: true, data: [] }),
    });
    render(Plugins);

    await screen.findByText("wakatime-sync");
    expect(screen.queryByText(/is not running in/i)).toBeNull();
  });
});
