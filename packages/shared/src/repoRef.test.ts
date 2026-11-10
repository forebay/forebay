import { describe, it, expect } from "vitest";
import { parseRepoRef, classifyRepoName, classifyRepoTopics, withMarketplaceMethod } from "./repoRef.js";

describe("parseRepoRef", () => {
  it("parses a full github url", () => {
    expect(parseRepoRef("https://github.com/forebay/claude-code-provider")).toEqual({
      owner: "forebay",
      repo: "claude-code-provider",
      url: "https://github.com/forebay/claude-code-provider",
    });
  });
  it("parses an owner/repo short ref", () => {
    expect(parseRepoRef("forebay/some-proxy")).toEqual({
      owner: "forebay",
      repo: "some-proxy",
      url: "https://github.com/forebay/some-proxy",
    });
  });
  it("strips a trailing .git and slash", () => {
    expect(parseRepoRef("https://github.com/o/r.git")?.repo).toBe("r");
    expect(parseRepoRef("https://github.com/o/r/")?.repo).toBe("r");
  });
  it("rejects malformed input", () => {
    expect(parseRepoRef("")).toBeNull();
    expect(parseRepoRef("   ")).toBeNull();
    expect(parseRepoRef("not-a-ref")).toBeNull();
    expect(parseRepoRef("https://gitlab.com/o/r")).toBeNull();
    expect(parseRepoRef("o/r/extra")).toBeNull();
  });
});

describe("classifyRepoName", () => {
  it("classifies by suffix", () => {
    expect(classifyRepoName("foo-proxy")).toBe("proxy");
    expect(classifyRepoName("foo-provider")).toBe("provider");
    expect(classifyRepoName("claude-code-loader")).toBe("host");
    expect(classifyRepoName("some-plugin")).toBe("plugin");
  });
  it("reads a reference repo's kind from the word before -stub", () => {
    expect(classifyRepoName("provider-stub")).toBe("provider");
    expect(classifyRepoName("proxy-stub")).toBe("proxy");
    expect(classifyRepoName("translator-stub")).toBe("translator");
    expect(classifyRepoName("plugin-stub")).toBe("plugin");
  });
  it("treats an unknown role word as a plugin, even one naming an object member", () => {
    expect(classifyRepoName("foo-constructor")).toBe("plugin");
  });
  it("returns null for core libraries, which are never installed on their own", () => {
    expect(classifyRepoName("core-proxy")).toBeNull();
    expect(classifyRepoName("core-ir")).toBeNull();
  });

  // A translator is installed in its own right now: a provider resolves it from the home's
  // shared store rather than only vendoring it as a submodule.
  it("classifies a vendor translator as its own kind", () => {
    expect(classifyRepoName("openai-translator")).toBe("translator");
    expect(classifyRepoName("anthropic-translator")).toBe("translator");
  });
});

describe("classifyRepoTopics", () => {
  it("maps an installable category topic to its kind", () => {
    expect(classifyRepoTopics(["forebay", "ai-provider"])).toBe("provider");
    expect(classifyRepoTopics(["app-proxy"])).toBe("proxy");
    expect(classifyRepoTopics(["app-loader"])).toBe("host");
    expect(classifyRepoTopics(["app-host"])).toBe("host");
    expect(classifyRepoTopics(["plugin", "typescript"])).toBe("plugin");
  });
  it("maps the vendor-translator topic to the translator kind", () => {
    expect(classifyRepoTopics(["vendor-translator", "runtime"])).toBe("translator");
  });

  it("returns null when no installable category topic is present", () => {
    expect(classifyRepoTopics([])).toBeNull();
    expect(classifyRepoTopics(["core-library"])).toBeNull();
    expect(classifyRepoTopics(["runtime", "dashboard"])).toBeNull();
  });
});

describe("withMarketplaceMethod", () => {
  it("adds the marketplace method when absent and never duplicates it", () => {
    expect(withMarketplaceMethod(undefined)).toEqual(["marketplace"]);
    expect(withMarketplaceMethod(["npm"])).toEqual(["marketplace", "npm"]);
    expect(withMarketplaceMethod(["npm", "marketplace"])).toEqual(["npm", "marketplace"]);
  });
});
