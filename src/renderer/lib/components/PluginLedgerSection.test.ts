// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import PluginLedgerSection from "./PluginLedgerSection.svelte";

const row = {
  pluginId: "historian", status: "active",
  capabilitiesDeclared: ["screens", "config-history"], capabilities: ["screens", "config-history"],
  provides: ["historian:history"], consumes: ["accounts"], unresolved: ["accounts"],
  topics: ["config.changed"], permissions: ["network", "accounts:read"],
};

describe("PluginLedgerSection", () => {
  it("shows the capabilities, services, topics and permissions of one home", () => {
    render(PluginLedgerSection, { groups: [{ home: { id: "app-a", label: "App A", dir: "/a", present: true, managesPlugins: true }, rows: [row] }], plugin: "historian" });
    expect(screen.getByText("App A")).toBeInTheDocument();
    expect(screen.getByText("config-history")).toBeInTheDocument();
    expect(screen.getByText("historian:history")).toBeInTheDocument();
    expect(screen.getByText("config.changed")).toBeInTheDocument();
    expect(screen.getByText("accounts:read")).toBeInTheDocument();
  });

  it("marks a consumed service nothing provides", () => {
    render(PluginLedgerSection, { groups: [{ home: { id: "app-a", label: "App A", dir: "/a", present: true, managesPlugins: true }, rows: [row] }], plugin: "historian" });
    expect(screen.getByText(/nothing in this home provides it/i)).toBeInTheDocument();
  });

  // "accounts" alone cannot tell a real unresolved check from one that marks every
  // consumed id: both would show exactly one marker. "screens" is resolved, so only a
  // real check against `unresolved` leaves it unmarked.
  it("does not mark a consumed service the home already provides", () => {
    const mixed = { ...row, consumes: ["accounts", "screens"], unresolved: ["accounts"] };
    render(PluginLedgerSection, { groups: [{ home: { id: "app-a", label: "App A", dir: "/a", present: true, managesPlugins: true }, rows: [mixed] }], plugin: "historian" });
    expect(screen.getAllByText(/nothing in this home provides it/i)).toHaveLength(1);
  });

  it("shows a declared capability the plugin never provided", () => {
    const broken = { ...row, capabilities: ["screens"], status: "broken", error: { detail: "activate threw", fix: "fix the error" } };
    render(PluginLedgerSection, { groups: [{ home: { id: "app-a", label: "App A", dir: "/a", present: true, managesPlugins: true }, rows: [broken] }], plugin: "historian" });
    expect(screen.getByText(/declared but not provided/i)).toBeInTheDocument();
    expect(screen.getByText("fix the error")).toBeInTheDocument();
  });

  it("says so when a plugin is in no home's ledger", () => {
    render(PluginLedgerSection, { groups: [], plugin: "historian" });
    expect(screen.getByText(/not loaded in any home/i)).toBeInTheDocument();
  });

  it("renders a quarantined home alongside a healthy one, each under its own label and reason", () => {
    render(PluginLedgerSection, {
      groups: [{ home: { id: "opencode-runtime", label: "OpenCode", dir: "/o", present: true, managesPlugins: true }, rows: [row] }],
      plugin: "historian",
      quarantine: [{
        homeId: "forebay-desktop", homeLabel: "Forebay",
        pluginId: "historian", detail: "historian is installed but the version in this home declares no plugin manifest",
        fix: "reinstall it from a channel that provides one, or wait for a release that does",
      }],
    });
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getByText("historian:history")).toBeInTheDocument();
    expect(screen.getByText("Forebay")).toBeInTheDocument();
    expect(screen.getByText("historian is installed but the version in this home declares no plugin manifest")).toBeInTheDocument();
    expect(screen.getByText("reinstall it from a channel that provides one, or wait for a release that does")).toBeInTheDocument();
    expect(screen.queryByText(/not loaded in any home/i)).toBeNull();
  });

  it("does not duplicate a home that is quarantined for a different plugin", () => {
    render(PluginLedgerSection, {
      groups: [],
      plugin: "historian",
      quarantine: [{
        homeId: "forebay-desktop", homeLabel: "Forebay",
        pluginId: "some-other-plugin", detail: "irrelevant", fix: "irrelevant",
      }],
    });
    expect(screen.getByText(/not loaded in any home/i)).toBeInTheDocument();
    expect(screen.queryByText("Forebay")).toBeNull();
  });
});
