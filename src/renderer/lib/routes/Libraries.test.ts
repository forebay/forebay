// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor, screen, within } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import { get } from "svelte/store";
import { router } from "../router.js";
import { rows as downloadRows, resetDownloadsForTest } from "../downloads.js";
import Libraries from "./Libraries.svelte";
import type { HomeLibraries, PluginHome } from "@forebay/shared";

function home(id: string, label: string): PluginHome {
  return { id, label, dir: `/${id}`, present: true, managesPlugins: true };
}

// The same library in two homes, one library used by a plugin, and one used by nothing.
function data(): HomeLibraries[] {
  return [
    {
      home: home("forebay", "Forebay"),
      shared: [
        { specifier: "@intisy-ai/basekit", version: "2.1.0", usedBy: ["stub-auth"] },
        { specifier: "@intisy-ai/left-behind", version: "1.0.0", usedBy: [] },
      ],
      plugins: [{ plugin: "stub-auth", dependencies: [{ specifier: "undici", version: "6.19.2", usedBy: [] }] }],
    },
    {
      home: home("claude", "Claude Code"),
      shared: [{ specifier: "@intisy-ai/basekit", version: "2.1.0", usedBy: ["stub-auth"] }],
      plugins: [],
    },
  ];
}

function row(specifier: string): HTMLElement {
  return screen.getByTestId(`library-${specifier}`);
}

describe("Libraries screen", () => {
  // The redesign: a library installed in two homes used to be listed once per home, which
  // read as two libraries.
  it("lists a library once however many homes hold it", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    render(Libraries);

    await screen.findByText("@intisy-ai/basekit");
    expect(screen.getAllByText("@intisy-ai/basekit")).toHaveLength(1);
  });

  it("names the homes a library is installed in, beside it", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    render(Libraries);

    const core = await waitFor(() => row("@intisy-ai/basekit"));
    expect(within(core).getByTitle("Forebay")).toBeInTheDocument();
    expect(within(core).getByTitle("Claude Code")).toBeInTheDocument();
  });

  it("says which plugins use a library, and calls one nothing uses unused", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    render(Libraries);

    expect(within(await waitFor(() => row("@intisy-ai/basekit"))).getByText("stub-auth")).toBeInTheDocument();
    expect(within(row("@intisy-ai/left-behind")).getByText("used by nothing installed")).toBeInTheDocument();
  });

  it("lists a plugin's own declared dependency too", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    render(Libraries);
    expect(await screen.findByText("undici")).toBeInTheDocument();
  });

  it("narrows to the unused ones on demand", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    render(Libraries);
    await screen.findByText("@intisy-ai/basekit");

    await fireEvent.click(screen.getByRole("button", { name: /^Unused/ }));

    await waitFor(() => expect(screen.queryByText("@intisy-ai/basekit")).toBeNull());
    expect(screen.getByText("@intisy-ai/left-behind")).toBeInTheDocument();
  });

  it("filters by specifier and by the plugin that uses it", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    const { container } = render(Libraries);
    await screen.findByText("@intisy-ai/basekit");

    await fireEvent.input(container.querySelector("input")!, { target: { value: "stub-auth" } });

    await waitFor(() => expect(screen.queryByText("@intisy-ai/left-behind")).toBeNull());
    expect(screen.getByText("@intisy-ai/basekit")).toBeInTheDocument();
  });

  // A library nothing declares is removable on its own; one in use is not, and the row offers
  // the only thing that would free it instead.
  it("removes an unused library from every home holding it, after confirming", async () => {
    const librariesRemove = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }), librariesRemove });
    render(Libraries);

    const orphan = await waitFor(() => row("@intisy-ai/left-behind"));
    await fireEvent.click(within(orphan).getByRole("button", { name: "Remove" }));

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(librariesRemove).toHaveBeenCalledWith("forebay", "@intisy-ai/left-behind"));
  });

  it("offers to uninstall the plugins using a library instead of removing it", async () => {
    const pluginsRemoveEverywhere = vi.fn(async () => ({ ok: true, data: { outcomes: [] } }) as const);
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }), pluginsRemoveEverywhere });
    render(Libraries);

    const core = await waitFor(() => row("@intisy-ai/basekit"));
    expect(within(core).queryByRole("button", { name: "Remove" })).toBeNull();
    await fireEvent.click(within(core).getByRole("button", { name: "Uninstall users" }));

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Uninstall" }));

    await waitFor(() => expect(pluginsRemoveEverywhere).toHaveBeenCalledWith("stub-auth"));
  });

  it("shows an inline error when the read fails", async () => {
    stubForebay({ librariesList: async () => ({ ok: false, error: "store unreadable" }) });
    render(Libraries);
    expect(await screen.findByText(/store unreadable/)).toBeInTheDocument();
  });
});

// A library used in one home and left over in another is the common case after uninstalling
// its last consumer there. Merging the two answers made the leftover unremovable, because the
// row claimed a user it only had somewhere else.
describe("a library left over in one home", () => {
  function split(): HomeLibraries[] {
    return [
      { home: home("forebay", "Forebay"), shared: [{ specifier: "@intisy-ai/openai-translator", version: "0.1.1", usedBy: [] }], plugins: [] },
      { home: home("claude", "Claude Code"), shared: [{ specifier: "@intisy-ai/openai-translator", version: "0.1.1", usedBy: ["custom-auth"] }], plugins: [] },
    ];
  }

  it("still offers to remove it, and names the home it is left over in", async () => {
    const librariesRemove = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({ librariesList: async () => ({ ok: true, data: split() }), librariesRemove });
    render(Libraries);

    const entry = await waitFor(() => row("@intisy-ai/openai-translator"));
    expect(within(entry).getByText("left over in Forebay")).toBeInTheDocument();
    await fireEvent.click(within(entry).getByRole("button", { name: "Remove" }));

    const dialog = within(await screen.findByRole("dialog"));
    await fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

    // Only the home that no longer needs it; the one still using it is left alone.
    await waitFor(() => expect(librariesRemove).toHaveBeenCalledWith("forebay", "@intisy-ai/openai-translator"));
    expect(librariesRemove).toHaveBeenCalledTimes(1);
  });

  it("counts as unused for the filter, since there is something to clean up", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: split() }) });
    render(Libraries);
    await screen.findByText("@intisy-ai/openai-translator");

    await fireEvent.click(screen.getByRole("button", { name: /^Unused/ }));

    expect(screen.getByText("@intisy-ai/openai-translator")).toBeInTheDocument();
  });
});

describe("navigating from a library to what uses it", () => {
  it("opens the plugin when its name is clicked", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: data() }) });
    render(Libraries);

    const core = await waitFor(() => row("@intisy-ai/basekit"));
    await fireEvent.click(within(core).getByRole("button", { name: "stub-auth" }));

    await waitFor(() => expect(get(router).screen).toBe("plugins"));
  });
});

// The list windows itself past a fixed row height, so a row that grew with its user count
// overlapped the row beneath it. The names that do not fit go behind a counter instead.
describe("a library with more users than fit on its row", () => {
  const MANY = ["a-plugin", "b-plugin", "c-plugin", "d-plugin", "e-plugin"];

  function crowded(): HomeLibraries[] {
    return [{ home: home("forebay", "Forebay"), shared: [{ specifier: "@intisy-ai/basekit", version: "2.1.0", usedBy: MANY }], plugins: [] }];
  }

  it("shows the first few and counts the rest", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: crowded() }) });
    render(Libraries);

    const core = await waitFor(() => row("@intisy-ai/basekit"));
    expect(within(core).getByRole("button", { name: "a-plugin" })).toBeInTheDocument();
    expect(within(core).queryByRole("button", { name: "d-plugin" })).toBeNull();
    expect(within(core).getByRole("button", { name: "+2 more" })).toBeInTheDocument();
  });

  it("reaches every one of them through the counter", async () => {
    stubForebay({ librariesList: async () => ({ ok: true, data: crowded() }) });
    render(Libraries);

    await fireEvent.click(within(await waitFor(() => row("@intisy-ai/basekit"))).getByRole("button", { name: "+2 more" }));

    const dialog = within(await screen.findByRole("dialog"));
    for (const plugin of MANY) expect(dialog.getByRole("button", { name: plugin })).toBeInTheDocument();

    await fireEvent.click(dialog.getByRole("button", { name: "e-plugin" }));
    await waitFor(() => expect(get(router).screen).toBe("plugins"));
  });
});

// Removing from here is a removal like any other: it belongs in Downloads rather than running
// invisibly behind a toast.
describe("progress for a removal started from a library", () => {
  it("reports uninstalling the plugins that use it", async () => {
    resetDownloadsForTest();
    stubForebay({
      librariesList: async () => ({ ok: true, data: data() }),
      pluginsRemoveEverywhere: async () => ({ ok: true, data: { outcomes: [] } }),
    });
    render(Libraries);

    await fireEvent.click(within(await waitFor(() => row("@intisy-ai/basekit"))).getByRole("button", { name: "Uninstall users" }));
    await fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Uninstall" }));

    await waitFor(() => expect(get(downloadRows).some((task) => task.label === "Remove stub-auth everywhere")).toBe(true));
  });

  it("reports removing the library itself", async () => {
    resetDownloadsForTest();
    stubForebay({
      librariesList: async () => ({ ok: true, data: data() }),
      librariesRemove: async () => ({ ok: true, data: undefined }),
    });
    render(Libraries);

    await fireEvent.click(within(await waitFor(() => row("@intisy-ai/left-behind"))).getByRole("button", { name: "Remove" }));
    await fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(get(downloadRows).some((task) => task.label === "Remove @intisy-ai/left-behind")).toBe(true));
  });
});
