// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import AddAccountDialog from "./AddAccountDialog.svelte";

const provider = { id: "stub", label: "Stub" };

describe("AddAccountDialog", () => {
  it("begins login on mount and renders the url, instructions, and a paste field", async () => {
    const accountsLoginBegin = vi.fn(async () => ({
      ok: true,
      data: { url: "https://example/login/stub", instructions: "Sign in, then paste the code here." },
    }) as const);
    stubForebay({ accountsLoginBegin });

    const { getByText, getByLabelText } = render(AddAccountDialog, { props: { provider, onClose: vi.fn(), onAdded: vi.fn() } });

    await waitFor(() => expect(accountsLoginBegin).toHaveBeenCalledWith("stub"));
    expect(getByText("https://example/login/stub")).toBeInTheDocument();
    expect(getByText(/sign in, then paste the code here/i)).toBeInTheDocument();
    expect(getByLabelText(/callback url or code/i)).toBeInTheDocument();
  });

  it("completes sign-in with the pasted code and reports success", async () => {
    const accountsLoginComplete = vi.fn(async () => ({ ok: true, data: { added: true, label: "a@stub.test" } }) as const);
    stubForebay({
      accountsLoginBegin: async () => ({ ok: true, data: { url: "https://example/login/stub", instructions: "Do the thing." } }),
      accountsLoginComplete,
    });
    const onAdded = vi.fn();

    const { getByLabelText, getByRole } = render(AddAccountDialog, { props: { provider, onClose: vi.fn(), onAdded } });
    await waitFor(() => expect(getByLabelText(/callback url or code/i)).toBeInTheDocument());

    await fireEvent.input(getByLabelText(/callback url or code/i), { target: { value: "the-code" } });
    await fireEvent.click(getByRole("button", { name: /complete sign-in/i }));

    await waitFor(() => expect(accountsLoginComplete).toHaveBeenCalledWith("stub", "the-code"));
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
  });

  // Where the loopback cannot reach the browser (a container, a provider with no localhost
  // redirect), the whole address bar is what the user has to hand. It goes through untouched:
  // pulling the code out of it is the provider's job, not the dialog's.
  it("forwards a pasted redirect URL as it stands", async () => {
    const accountsLoginComplete = vi.fn(async () => ({ ok: true, data: { added: true } }) as const);
    stubForebay({
      accountsLoginBegin: async () => ({ ok: true, data: { url: "https://example/login/stub", instructions: "" } }),
      accountsLoginComplete,
    });

    const { getByLabelText, getByRole } = render(AddAccountDialog, { props: { provider, onClose: vi.fn(), onAdded: vi.fn() } });
    const field = await waitFor(() => getByLabelText(/callback url or code/i));
    const redirect = "http://localhost:51121/callback?code=abc123&state=xyz";

    await fireEvent.input(field, { target: { value: redirect } });
    await fireEvent.click(getByRole("button", { name: /complete sign-in/i }));

    await waitFor(() => expect(accountsLoginComplete).toHaveBeenCalledWith("stub", redirect));
  });

  it("shows the begin error and renders no paste field", async () => {
    stubForebay({ accountsLoginBegin: async () => ({ ok: false, error: "this provider does not support in-app login" }) });

    const { findByText, queryByLabelText } = render(AddAccountDialog, { props: { provider, onClose: vi.fn(), onAdded: vi.fn() } });

    expect(await findByText(/this provider does not support in-app login/i)).toBeInTheDocument();
    expect(queryByLabelText(/callback url or code/i)).toBeNull();
  });

  it("calls accountsLoginCancel then onClose on Escape", async () => {
    const accountsLoginCancel = vi.fn(async () => ({ ok: true, data: undefined }) as const);
    stubForebay({
      accountsLoginBegin: async () => ({ ok: true, data: { url: "https://example/login/stub", instructions: "" } }),
      accountsLoginCancel,
    });
    const onClose = vi.fn();

    render(AddAccountDialog, { props: { provider, onClose, onAdded: vi.fn() } });
    await fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(accountsLoginCancel).toHaveBeenCalledWith("stub"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
