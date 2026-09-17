// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { stubCairn } from "../testing.js";
import TestWrapper from "./AddPluginDialog.test.svelte";

describe("AddPluginDialog", () => {
  it("derives the repo name and kind from a pasted url and installs it", async () => {
    const pluginsInstall = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubCairn({ pluginsInstall });

    const { getByPlaceholderText, getByText, getByRole } = render(TestWrapper, { props: { home: "cairn" } });

    await fireEvent.input(getByPlaceholderText("owner/repo or GitHub URL"), {
      target: { value: "https://github.com/forebay/some-proxy" },
    });

    expect(getByText("some-proxy")).toBeInTheDocument();
    // "proxy" also appears as a <select> option, so scope the kind-chip assertion.
    expect(getByText("proxy", { selector: ".kind" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: /install/i }));

    await waitFor(() => expect(pluginsInstall).toHaveBeenCalledWith("cairn", "some-proxy", "https://github.com/forebay/some-proxy"));
  });

  it("disables install for a malformed reference", async () => {
    stubCairn({});
    const { getByPlaceholderText, getByRole } = render(TestWrapper);
    await fireEvent.input(getByPlaceholderText("owner/repo or GitHub URL"), { target: { value: "not a ref" } });
    expect((getByRole("button", { name: /install/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
