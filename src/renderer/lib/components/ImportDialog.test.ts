// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import TestWrapper from "./ImportDialog.test.svelte";

describe("ImportDialog", () => {
  it("shows preview counts and imports only the selected categories", async () => {
    const importRun = vi.fn(async () => ({ ok: true, data: { accounts: 2, providers: 2, routingImported: false, notes: ["done"] } }) as const);
    stubForebay({
      importPreview: async () => ({ ok: true, data: { accounts: 2, routingSlots: 3, exposedProviders: 4 } }),
      importRun,
    });

    const { getByText, getByLabelText, getByRole } = render(TestWrapper, { props: { app: "claude" } });

    await waitFor(() => expect(getByText("2")).toBeInTheDocument());

    await fireEvent.click(getByLabelText(/routing/i));
    await fireEvent.click(getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(importRun).toHaveBeenCalledWith("claude", { accounts: true, routing: false, exposure: true }));
  });
});
