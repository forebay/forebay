import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCache, readNamespace, writeCache, dropCache, resetCacheForTests } from "./cache.js";

let dir: string;

beforeEach(() => {
  resetCacheForTests();
  dir = mkdtempSync(join(tmpdir(), "forebay-cache-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("generic cache", () => {
  it("round-trips a value through the namespace and key", () => {
    writeCache("stars", "o/r", 42, dir);
    expect(readCache<number>("stars", "o/r", dir)?.value).toBe(42);
  });

  it("persists across an in-memory reset (survives a restart)", () => {
    writeCache("versions", "plugin-a", { claude: "v1" }, dir);
    resetCacheForTests();
    expect(readCache<{ claude: string }>("versions", "plugin-a", dir)?.value).toEqual({ claude: "v1" });
  });

  it("reads a whole namespace at once", () => {
    writeCache("stars", "o/a", 1, dir);
    writeCache("stars", "o/b", 2, dir);
    expect(Object.keys(readNamespace("stars", dir)).sort()).toEqual(["o/a", "o/b"]);
  });

  it("only writes when the value changed", () => {
    expect(writeCache("k", "x", { a: 1 }, dir)).toBe(true);
    expect(writeCache("k", "x", { a: 1 }, dir)).toBe(false);
    expect(writeCache("k", "x", { a: 2 }, dir)).toBe(true);
  });

  it("drops an entry", () => {
    writeCache("k", "x", 1, dir);
    dropCache("k", "x", dir);
    expect(readCache("k", "x", dir)).toBeNull();
  });

  it("degrades to a miss with no config dir", () => {
    expect(writeCache("k", "x", 1, "")).toBe(false);
    expect(readCache("k", "x", "")).toBeNull();
    expect(readNamespace("k", "")).toEqual({});
  });
});
