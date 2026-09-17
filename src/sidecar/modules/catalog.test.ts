import { describe, it, expect } from "vitest";
import { catalogList } from "./catalog.js";

describe("catalogList", () => {
  it("wraps scanOrg into Result", async () => {
    const result = await catalogList({
      fetchFn: (async () => ({ ok: true, status: 200, json: async () => [{ name: "stub-auth", html_url: "https://github.com/forebay/stub-auth", description: "desc", archived: false, topics: ["ai-provider"] }] })) as unknown as typeof fetch,
      env: {},
      execFn: async () => "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.entries).toHaveLength(1);
      expect(result.data.entries[0].name).toBe("stub-auth");
      expect(result.data.source).toBe("anonymous");
      expect(result.data.rateLimited).toBe(false);
    }
  });
});
