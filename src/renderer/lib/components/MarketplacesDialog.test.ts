// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, waitFor, within } from "@testing-library/svelte";
import { stubCairn } from "../testing.js";
import MarketplacesDialog from "./MarketplacesDialog.svelte";
import type { MarketplaceSource } from "@cairn/shared";

const noop = (): void => {};

const configured: MarketplaceSource[] = [
  { id: "forebay", label: "forebay", type: "github-org", org: "forebay" },
  { id: "demo", label: "Demo", type: "local", path: "/tmp/demo" },
];

function stub(save = vi.fn(async (sources: MarketplaceSource[]) => ({ ok: true, data: sources }) as const)) {
  stubCairn({
    marketplaceSourcesList: async () => ({ ok: true, data: configured }),
    marketplaceSourcesSave: save,
  });
  return save;
}

describe("MarketplacesDialog", () => {
  it("lists the configured marketplaces with their rank and location", async () => {
    stub();
    render(MarketplacesDialog, { props: { onClose: noop } });

    const first = await screen.findByTestId("source-forebay");
    expect(first).toHaveTextContent("1");
    expect(first).toHaveTextContent("GitHub org");
    expect(await screen.findByTestId("source-demo")).toHaveTextContent("/tmp/demo");
  });

  // Order is priority, so reordering is the one edit that changes which marketplace wins.
  it("saves the new order after moving a marketplace up", async () => {
    const save = stub();
    render(MarketplacesDialog, { props: { onClose: noop } });

    const demo = await screen.findByTestId("source-demo");
    await fireEvent.click(within(demo).getByTitle("Move up"));
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].map((s: MarketplaceSource) => s.id)).toEqual(["demo", "forebay"]);
  });

  it("adds a marketplace with the location field its type asks for", async () => {
    const save = stub();
    render(MarketplacesDialog, { props: { onClose: noop } });
    await screen.findByTestId("source-demo");

    await fireEvent.input(screen.getByLabelText("Marketplace id"), { target: { value: "acme" } });
    await fireEvent.input(screen.getByLabelText("Marketplace location"), { target: { value: "https://acme.test/m.json" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const added = save.mock.calls[0][0].find((s: MarketplaceSource) => s.id === "acme");
    expect(added).toMatchObject({ type: "manifest", url: "https://acme.test/m.json", label: "acme" });
  });

  it("refuses to add one whose id is already taken, without saving", async () => {
    const save = stub();
    render(MarketplacesDialog, { props: { onClose: noop } });
    await screen.findByTestId("source-demo");

    await fireEvent.input(screen.getByLabelText("Marketplace id"), { target: { value: "demo" } });
    await fireEvent.input(screen.getByLabelText("Marketplace location"), { target: { value: "https://acme.test/m.json" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/already a marketplace with the id demo/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("removes a marketplace from the saved list", async () => {
    const save = stub();
    render(MarketplacesDialog, { props: { onClose: noop } });

    const demo = await screen.findByTestId("source-demo");
    await fireEvent.click(within(demo).getByRole("button", { name: "Remove" }));
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].map((s: MarketplaceSource) => s.id)).toEqual(["forebay"]);
  });

  // Switched off keeps it configured, so it can be turned back on without retyping it.
  it("disables a marketplace instead of removing it", async () => {
    const save = stub();
    render(MarketplacesDialog, { props: { onClose: noop } });

    const demo = await screen.findByTestId("source-demo");
    await fireEvent.click(within(demo).getByRole("button", { name: "Disable" }));
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].find((s: MarketplaceSource) => s.id === "demo")?.enabled).toBe(false);
  });

  it("closes without saving when cancelled", async () => {
    const save = stub();
    const onClose = vi.fn();
    render(MarketplacesDialog, { props: { onClose } });
    await screen.findByTestId("source-demo");

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
