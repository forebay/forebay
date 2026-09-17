import { describe, it, expect } from "vitest";
import { parseRepoRef, classifyRepoName, classifyRepoTopics } from "./repoRef.js";

describe("parseRepoRef", () => {
  it("parses a full github url", () => {
    expect(parseRepoRef("https://github.com/forebay/claude-code-auth")).toEqual({
      owner: "forebay",
      repo: "claude-code-auth",
      url: "https://github.com/forebay/claude-code-auth",
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
    expect(classifyRepoName("foo-auth")).toBe("provider");
    expect(classifyRepoName("claude-code-loader")).toBe("loader");
    expect(classifyRepoName("some-plugin")).toBe("plugin");
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
    expect(classifyRepoTopics(["app-loader"])).toBe("loader");
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
