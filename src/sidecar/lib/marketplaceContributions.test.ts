import { describe, it, expect } from "vitest";
import { readMarketplaceContributions } from "./marketplaceContributions.js";
import { matchesContribution } from "../../../packages/shared/src/repoRef.js";
import type { CatalogEntry, MarketplaceContribution } from "../../../packages/shared/src/domain.js";

function manifests(files: Record<string, unknown>): {
  reposDir: string;
  listRepos: () => string[];
  readManifest: (path: string) => string | null;
} {
  return {
    reposDir: "/repos",
    listRepos: () => Object.keys(files),
    readManifest: (path: string) => {
      const plugin = path.split(/[\\/]/).at(-2) as string;
      const manifest = files[plugin];
      return manifest === undefined ? null : JSON.stringify(manifest);
    },
  };
}

const translatorCategory = {
  marketplace: { categories: [{ id: "translators", label: "Translators", match: { topics: ["vendor-translator"] } }] },
};

describe("readMarketplaceContributions", () => {
  it("reads the categories an installed plugin declares", () => {
    const contributions = readMarketplaceContributions(manifests({ "custom-provider": translatorCategory }));
    expect(contributions).toEqual([
      { id: "translators", label: "Translators", match: { topics: ["vendor-translator"], kind: undefined }, contributedBy: "custom-provider" },
    ]);
  });

  it("names a category by its id when it declares no label", () => {
    const contributions = readMarketplaceContributions(manifests({
      p: { marketplace: { categories: [{ id: "vendors", match: { kind: "translator" } }] } },
    }));
    expect(contributions[0].label).toBe("vendors");
  });

  it("ignores a plugin with no marketplace block, and one whose manifest is unreadable", () => {
    const deps = manifests({ plain: { displayName: "Plain" }, "custom-provider": translatorCategory });
    const contributions = readMarketplaceContributions({
      ...deps,
      readManifest: (path) => (path.includes("broken") ? "{ not json" : deps.readManifest(path)),
    });
    expect(contributions.map((c) => c.id)).toEqual(["translators"]);
  });

  it("drops a category that names no id or no match, which could never select anything", () => {
    const contributions = readMarketplaceContributions(manifests({
      p: { marketplace: { categories: [{ label: "No id", match: { kind: "translator" } }, { id: "no-match" }, { id: "ok", match: { kind: "plugin" } }] } },
    }));
    expect(contributions.map((c) => c.id)).toEqual(["ok"]);
  });

  it("gives two plugins asking for the same category one chip, not two", () => {
    const contributions = readMarketplaceContributions(manifests({ a: translatorCategory, b: translatorCategory }));
    expect(contributions).toHaveLength(1);
    expect(contributions[0].contributedBy).toBe("a");
  });

  it("reads nothing when no repos directory is known", () => {
    expect(readMarketplaceContributions()).toEqual([]);
  });
});

describe("matchesContribution", () => {
  const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
    name: "x", url: "u", kind: "plugin", description: "", deprecated: false, topics: [], ...over,
  });
  const byTopic: MarketplaceContribution = { id: "t", label: "T", match: { topics: ["vendor-translator"] }, contributedBy: "p" };

  // The whole point: a translator published later carries the topic and matches, with no
  // change to the plugin that declared the category.
  it("matches an entry carrying one of the declared topics", () => {
    expect(matchesContribution(entry({ topics: ["vendor-translator", "openai"] }), byTopic)).toBe(true);
    expect(matchesContribution(entry({ topics: ["plugin"] }), byTopic)).toBe(false);
  });

  it("matches on kind when the category declares one", () => {
    const byKind: MarketplaceContribution = { id: "k", label: "K", match: { kind: "translator" }, contributedBy: "p" };
    expect(matchesContribution(entry({ kind: "translator" }), byKind)).toBe(true);
    expect(matchesContribution(entry({ kind: "provider" }), byKind)).toBe(false);
  });

  it("requires both when a category declares a kind and topics", () => {
    const both: MarketplaceContribution = { id: "b", label: "B", match: { kind: "translator", topics: ["openai"] }, contributedBy: "p" };
    expect(matchesContribution(entry({ kind: "translator", topics: ["openai"] }), both)).toBe(true);
    expect(matchesContribution(entry({ kind: "translator", topics: ["gemini"] }), both)).toBe(false);
  });
});
