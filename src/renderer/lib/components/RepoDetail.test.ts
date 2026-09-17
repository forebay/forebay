// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent, screen } from "@testing-library/svelte";
import { stubForebay } from "../testing.js";
import RepoDetail from "./RepoDetail.svelte";

const repo = {
  name: "plugin-updater",
  url: "https://github.com/forebay/plugin-updater",
  kind: "plugin",
  displayName: "Plugin Updater",
  description: "catalog desc",
  topics: ["a"],
};

describe("RepoDetail", () => {
  it("renders repo meta: display name, slug, stars, description, topics and readme", async () => {
    stubForebay({
      repoMeta: async () => ({
        ok: true,
        data: {
          owner: "forebay",
          repo: "plugin-updater",
          htmlUrl: "https://github.com/forebay/plugin-updater",
          stars: 42,
          description: "live desc",
          topics: ["x", "y"],
          readme: "# Hello\n\nbody",
        },
      }),
    });
    render(RepoDetail, { props: { repo, onClose: () => {} } });

    expect(await screen.findByText("Plugin Updater")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("forebay/plugin-updater")).toBeInTheDocument());
    expect(screen.getByText(/★\s*42/)).toBeInTheDocument();
    expect(screen.getByText("live desc")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".md h1")).toBeInTheDocument());
  });

  it("falls back to catalog description/topics/name when meta is unavailable", async () => {
    stubForebay({ repoMeta: async () => ({ ok: false, error: "boom" }) });
    render(RepoDetail, { props: { repo, onClose: () => {} } });

    expect(await screen.findByText("catalog desc")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("plugin-updater")).toBeInTheDocument();
  });

  it("opens GitHub in a new tab and closes on Escape", async () => {
    const onClose = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    stubForebay({
      repoMeta: async () => ({
        ok: true,
        data: { owner: "o", repo: "r", htmlUrl: "https://github.com/o/r", stars: null, description: "", topics: [], readme: null },
      }),
    });
    render(RepoDetail, { props: { repo, onClose } });

    await fireEvent.click(await screen.findByRole("button", { name: "View on GitHub" }));
    expect(openSpy).toHaveBeenCalledWith("https://github.com/o/r", "_blank");

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
