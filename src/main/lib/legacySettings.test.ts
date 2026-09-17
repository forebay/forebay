import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLegacySettings } from "./legacySettings.js";

function storeWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "forebay-legacy-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "config", name), body);
  return dir;
}

describe("migrateLegacySettings", () => {
  it("carries the legacy settings file across, content intact", () => {
    const dir = storeWith({ "cairn.json": JSON.stringify({ localApiPort: 4321 }) });

    expect(migrateLegacySettings(dir)).toBe(true);

    expect(existsSync(join(dir, "config", "cairn.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "config", "forebay.json"), "utf8"))).toEqual({ localApiPort: 4321 });
  });

  it("leaves a store that already has current settings alone", () => {
    const dir = storeWith({ "cairn.json": '{"localApiPort":1}', "forebay.json": '{"localApiPort":2}' });

    expect(migrateLegacySettings(dir)).toBe(false);

    expect(JSON.parse(readFileSync(join(dir, "config", "forebay.json"), "utf8")).localApiPort).toBe(2);
    expect(existsSync(join(dir, "config", "cairn.json"))).toBe(true);
  });

  it("does nothing, and reports so, when there is nothing to carry", () => {
    const dir = storeWith({});
    expect(migrateLegacySettings(dir)).toBe(false);
    expect(existsSync(join(dir, "config", "forebay.json"))).toBe(false);
  });
});
