// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import type { PluginConfigSchema, PluginSettingsSection } from "@forebay/shared";
import ContributedSection from "./ContributedSection.svelte";

const SCHEMA: PluginConfigSchema = {
  plugin: "a-plugin",
  defaults: { on: true },
  current: {},
  fields: [{ key: "on", type: "boolean", label: "On" }],
  layout: {
    sections: [{ id: "feature", label: "Feature", plugin: "a-plugin", fields: [{ key: "on", type: "boolean", label: "On" }], actions: [] }],
    fields: [],
    actions: [],
  },
};

function section(overrides: Partial<PluginSettingsSection> = {}): PluginSettingsSection {
  return { plugin: "a-plugin", id: "feature", label: "Feature", homes: ["claude"], ...overrides };
}

describe("ContributedSection", () => {
  it("names the plugin that added it", async () => {
    stubForebay({ configSchemas: async () => ({ ok: true, data: [SCHEMA] }) });
    render(ContributedSection, { section: section() });
    expect(await screen.findByText("Added by a-plugin")).toBeInTheDocument();
  });

  it("lets the reader pick a home when the same section is offered by several", async () => {
    const asked: string[] = [];
    stubForebay({ configSchemas: async (home: string) => { asked.push(home); return { ok: true, data: [SCHEMA] }; } });
    render(ContributedSection, {
      section: section({ homes: ["claude", "opencode"] }),
      homeLabels: { claude: "Claude Code", opencode: "OpenCode" },
    });

    await waitFor(() => expect(asked).toEqual(["claude"]));
    await fireEvent.click(screen.getByRole("button", { name: "OpenCode" }));
    await waitFor(() => expect(asked).toEqual(["claude", "opencode"]));
  });

  // A setting the plugin declared as spanning homes has one value, so offering a home to
  // pick would imply a choice that does not exist.
  it("offers no home choice for a section that spans homes, and writes to all of them", async () => {
    const writes: unknown[][] = [];
    stubForebay({
      configSchemas: async () => ({ ok: true, data: [SCHEMA] }),
      configWrite: async (...args: unknown[]) => { writes.push(args); return { ok: true, data: undefined }; },
    });
    render(ContributedSection, {
      section: section({ homes: ["claude", "opencode"], scope: "allHomes" }),
      homeLabels: { claude: "Claude Code", opencode: "OpenCode" },
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "OpenCode" })).toBeNull());
    await fireEvent.click(await screen.findByRole("switch", { name: "a-plugin On" }));
    await waitFor(() => expect(writes).toEqual([
      ["claude", "a-plugin", "on", false],
      ["opencode", "a-plugin", "on", false],
    ]));
  });

  it("says so when the plugin has no schema in the selected home", async () => {
    stubForebay({ configSchemas: async () => ({ ok: true, data: [] }) });
    render(ContributedSection, { section: section(), homeLabels: { claude: "Claude Code" } });
    expect(await screen.findByText(/not configurable in Claude Code/)).toBeInTheDocument();
  });

  it("reports a failed read instead of rendering an empty frame", async () => {
    stubForebay({ configSchemas: async () => ({ ok: false, error: "probe exploded" }) });
    render(ContributedSection, { section: section() });
    expect(await screen.findByText(/probe exploded/)).toBeInTheDocument();
  });
});
