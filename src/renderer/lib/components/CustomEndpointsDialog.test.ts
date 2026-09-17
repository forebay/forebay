// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { stubCairn } from "../testing.js";
import TestWrapper from "./CustomEndpointsDialog.test.svelte";

const INSTALLED_ENGINE = { id: "engine-a", capability: "custom-endpoints", url: "https://github.com/forebay/custom-auth", homes: { cairn: { installed: true, enabled: true } } };
const UNINSTALLED_ENGINE = { id: "engine-a", capability: "custom-endpoints", url: "https://github.com/forebay/custom-auth", homes: { cairn: { installed: false, enabled: false } } };

describe("CustomEndpointsDialog", () => {
  it("lists endpoints with a key-set badge", async () => {
    stubCairn({
      enginesList: async () => ({ ok: true, data: [INSTALLED_ENGINE] }),
      customEndpointsList: async () => ({ ok: true, data: [{ id: "local", label: "Local", baseUrl: "https://ep/v1", format: "openai", models: ["gpt-4o"], hasKey: true }] }),
    });
    const { findByText } = render(TestWrapper);
    expect(await findByText("Local")).toBeInTheDocument();
    expect(await findByText(/key set/i)).toBeInTheDocument();
  });

  it("adds an endpoint via upsert", async () => {
    const customEndpointsUpsert = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubCairn({ enginesList: async () => ({ ok: true, data: [INSTALLED_ENGINE] }), customEndpointsUpsert });
    const { getByLabelText, getByRole } = render(TestWrapper);
    await fireEvent.input(getByLabelText(/endpoint id/i), { target: { value: "prod" } });
    await fireEvent.input(getByLabelText(/label/i), { target: { value: "Prod" } });
    await fireEvent.input(getByLabelText(/base url/i), { target: { value: "https://prod/v1" } });
    await fireEvent.input(getByLabelText(/models/i), { target: { value: "gpt-4o, gpt-4o-mini" } });
    await fireEvent.click(getByRole("button", { name: /add endpoint/i }));
    await waitFor(() => expect(customEndpointsUpsert).toHaveBeenCalledWith({ id: "prod", label: "Prod", baseUrl: "https://prod/v1", format: "openai", models: ["gpt-4o", "gpt-4o-mini"] }));
  });

  it("saves a key write-only (never rendered back)", async () => {
    const customEndpointsSaveKey = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubCairn({
      enginesList: async () => ({ ok: true, data: [INSTALLED_ENGINE] }),
      customEndpointsList: async () => ({ ok: true, data: [{ id: "local", label: "Local", baseUrl: "https://ep/v1", format: "openai", models: ["m"], hasKey: false }] }),
      customEndpointsSaveKey,
    });
    const { findByLabelText, getByRole } = render(TestWrapper);
    const keyInput = await findByLabelText(/api key for local/i);
    expect((keyInput as HTMLInputElement).type).toBe("password");
    await fireEvent.input(keyInput, { target: { value: "sk-xyz" } });
    await fireEvent.click(getByRole("button", { name: /save key/i }));
    await waitFor(() => expect(customEndpointsSaveKey).toHaveBeenCalledWith("local", "sk-xyz"));
  });

  it("shows an empty state rather than an error when this home has no provider for the capability", async () => {
    stubCairn({
      enginesList: async () => ({ ok: true, data: [INSTALLED_ENGINE] }),
      customEndpointsList: async () => ({ ok: true, data: [] }),
    });
    const { findByText, queryByText } = render(TestWrapper);
    expect(await findByText(/no endpoints yet/i)).toBeInTheDocument();
    expect(queryByText(/no plugin provides custom endpoints/i)).not.toBeInTheDocument();
  });

  it("offers to install the engine when it is not installed", async () => {
    const enginesEnsure = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubCairn({ enginesList: async () => ({ ok: true, data: [UNINSTALLED_ENGINE] }), enginesEnsure });
    const { findByRole } = render(TestWrapper);
    const installBtn = await findByRole("button", { name: /install engine/i });
    await fireEvent.click(installBtn);
    await waitFor(() => expect(enginesEnsure).toHaveBeenCalledWith("custom-endpoints"));
  });
});
