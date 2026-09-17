import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDescriptor } from "@intisy-ai/basekit";

const stubHandlerPath = fileURLToPath(new URL("../../../../../plugins/providers/stub-auth/dist/handler.js", import.meta.url));
const stubIsCheckedOut = existsSync(stubHandlerPath);

const ENV_KEYS = [
  "OPENCODE_DIR",
  "LOCALAPPDATA",
  "HUB_OPENCODE_DIR",
  "HUB_OPENCODE_DATA_DIR",
  "OPENCODE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "HUB_CLAUDE_DIR",
  "CLAUDE_CONFIG_DIR",
  "HUB_CONFIG_DIR",
  "HUB_APPS_FILE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let tempDir: string;

// usageSnapshot() -> buildSessionsWithCosts() reads app.usage.formats off
// getApps() (see vendor/usage/sessions.test.ts), which now comes solely from
// the apps.json registry, so claude/opencode need seeding with the same home
// fields and usage formats as the real loader descriptors (loaders/*/plugin.json).
const claudeApp: AppDescriptor = {
  id: "claude",
  label: "Claude Code",
  home: { envOverride: "HUB_CLAUDE_DIR", nativeEnv: "CLAUDE_CONFIG_DIR", candidates: ["~/.claude", "~/.config/claude"] },
  detect: { binary: "claude", pkg: "@anthropic-ai/claude-code" },
  commandsSubdir: "commands",
  proxyPort: 34567,
  integration: "env-baseurl",
  wireFormat: "anthropic",
  usage: { formats: ["claude-jsonl"] },
};

const opencodeApp: AppDescriptor = {
  id: "opencode",
  label: "OpenCode",
  home: { envOverride: "HUB_OPENCODE_DIR", nativeEnv: "OPENCODE_CONFIG_DIR", xdgSubdir: "opencode", candidates: ["~/.config/opencode", "~/.opencode"] },
  detect: { binary: "opencode", pkg: "opencode-ai" },
  commandsSubdir: "command",
  proxyPort: 34568,
  integration: "native",
  wireFormat: "anthropic",
  usage: { formats: ["opencode-sqlite", "opencode-legacy-files"] },
};

// buildSnapshot() reads sessions from the real OpenCode/Claude Code homes when
// not overridden, so every test pins all three homes to empty temp dirs to
// avoid asserting on this machine's real usage data (see vendor/usage tests).
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "dash-usage-"));
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HUB_CONFIG_DIR = join(tempDir, "config-home");
  process.env.HUB_OPENCODE_DIR = join(tempDir, "opencode-home");
  process.env.HUB_OPENCODE_DATA_DIR = join(tempDir, "opencode-data-home");
  process.env.HUB_CLAUDE_DIR = join(tempDir, "claude-home");
  process.env.HUB_APPS_FILE = join(tempDir, "apps.json");
  writeFileSync(process.env.HUB_APPS_FILE, JSON.stringify({ claude: claudeApp, opencode: opencodeApp }));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function seedStubProvider(): void {
  const configDir = process.env.HUB_CONFIG_DIR as string;
  const repoDir = join(configDir, "repos", "stub-auth");
  mkdirSync(join(repoDir, "dist"), { recursive: true });
  writeFileSync(
    join(repoDir, "package.json"),
    JSON.stringify({
      name: "stub-auth",
      claudeHub: { authProviders: [{ name: "stub", handler: "dist/handler.js" }] },
    }),
  );
  copyFileSync(stubHandlerPath, join(repoDir, "dist", "handler.js"));
}

function seedClaudeSession(): void {
  const claudeHome = process.env.HUB_CLAUDE_DIR as string;
  const projectDir = join(claudeHome, "projects", "-my-test-project");
  mkdirSync(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:05:00.000Z",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 10, output_tokens: 5 } },
    }),
  ];
  writeFileSync(join(projectDir, "session-abc.jsonl"), lines.join("\n"), "utf-8");
}

// dayKeyFor (vendor/usage/sessions.ts) buckets by local calendar date, so the
// expected key is derived the same way instead of a hardcoded string.
function localDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function seedMultiModelClaudeSession(): { day1: number; day2: number } {
  const claudeHome = process.env.HUB_CLAUDE_DIR as string;
  const projectDir = join(claudeHome, "projects", "-multi-model-project");
  mkdirSync(projectDir, { recursive: true });
  const day1 = Date.UTC(2026, 0, 1, 12, 0, 0);
  const day2 = Date.UTC(2026, 0, 2, 12, 0, 0);
  const lines = [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(day1).toISOString(),
      message: { model: "claude-sonnet", usage: { input_tokens: 20, output_tokens: 5 } },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(day2).toISOString(),
      message: { model: "claude-haiku", usage: { input_tokens: 10, output_tokens: 5 } },
    }),
  ];
  writeFileSync(join(projectDir, "session-multi.jsonl"), lines.join("\n"), "utf-8");
  return { day1, day2 };
}

describe("usage sidecar module", () => {
// The sibling provider checkout is there in the workspace and absent when this repo is cloned on
// its own, which is what CI does. Skipped rather than failed there: a deployed provider bundle is
// what this asserts against, and no stand-in would be asserting the same thing.
  it.skipIf(!stubIsCheckedOut)("returns real sessions and models from the vendored snapshot layer alongside deployed-provider accounts", async () => {
    seedStubProvider();
    seedClaudeSession();
    const { addAccount } = await import("@intisy-ai/basekit/auth");
    addAccount("stub", { id: "a1", email: "a1@example.com", refresh: "r1", enabled: true });

    const { usageSnapshot } = await import("./usage.js");
    const result = await usageSnapshot();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.data.accounts).toEqual([{ provider: "stub", id: "a1" }]);

    expect(result.data.sessions).toHaveLength(1);
    const session = result.data.sessions[0];
    expect(session.id).toBe("session-abc");
    expect(session.source).toBe("claude");
    expect(session.messageCount).toBe(2);
    expect(session.tokens).toEqual({ input: 1010, output: 205, reasoning: 0, cacheRead: 50, cacheWrite: 10 });
    expect(session.title).toBe("my test project");
    expect("cost" in session).toBe(false);

    expect(Object.keys(result.data.models)).toEqual(["claude-sonnet-5"]);
    const model = result.data.models["claude-sonnet-5"];
    expect(model.provider).toBe("anthropic");
    expect(model.tokens).toEqual({ input: 1010, output: 205, reasoning: 0 });
    expect(model.sessionCount).toBe(1);
    expect(model.messageCount).toBe(2);
    expect(model.priced).toBe(true);
    expect(model.estimatedCostUsd).toBeCloseTo((1010 * 3 + 205 * 15) / 1_000_000, 9);

    expect(result.data.pricedModels).toBe(1);
    expect(result.data.unpricedModels).toBe(0);
    expect(result.data.estimatedCostUsd).toBeCloseTo(model.estimatedCostUsd ?? 0, 9);
    expect(typeof result.data.pricesUpdatedAt).toBe("string");

    expect(typeof result.data.updatedAt).toBe("string");
    expect(result.data.updatedAt.length).toBeGreaterThan(0);
  });

  it("returns ok:true with empty accounts/sessions/models when no sources are present", async () => {
    const { usageSnapshot } = await import("./usage.js");
    const result = await usageSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.accounts).toEqual([]);
    expect(result.data.sessions).toEqual([]);
    expect(result.data.models).toEqual({});
  });

  it("exposes per-session costByDay and per-model token totals", async () => {
    const { day1, day2 } = seedMultiModelClaudeSession();
    const { usageSnapshot } = await import("./usage.js");
    const result = await usageSnapshot();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.data.sessions).toHaveLength(1);
    const session = result.data.sessions[0];

    const key1 = localDayKey(day1);
    const key2 = localDayKey(day2);
    expect(session.costByDay[key1]).toEqual({ tokens: 25, tokensInput: 20, tokensOutput: 5, tokensReasoning: 0, messageCount: 1 });
    expect(session.costByDay[key2]).toEqual({ tokens: 15, tokensInput: 10, tokensOutput: 5, tokensReasoning: 0, messageCount: 1 });

    const models = [...session.models].sort((a, b) => b.tokens - a.tokens);
    expect(models).toEqual([
      { id: "claude-sonnet", provider: "anthropic", tokens: 25 },
      { id: "claude-haiku", provider: "anthropic", tokens: 15 },
    ]);
  });
});
