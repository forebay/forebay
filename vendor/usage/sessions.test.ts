import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildSessionsWithCosts, buildModelSummary } from "./sessions.js";
import type { Session } from "./types.js";
import type { AppDescriptor } from "@intisy-ai/basekit";

// See db.test.ts for why node:sqlite is loaded via createRequire instead of a
// static import.
interface TestSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): void; all(): unknown[] };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => TestSqliteDatabase;
};

const ENV_KEYS = [
  "OPENCODE_DIR",
  "LOCALAPPDATA",
  "HUB_OPENCODE_DIR",
  "HUB_OPENCODE_DATA_DIR",
  "OPENCODE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "HUB_CLAUDE_DIR",
  "CLAUDE_CONFIG_DIR",
  "HUB_APPS_FILE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let tempDir: string;

// buildSessionsWithCosts() reads app.usage.formats off getApps() (see
// vendor/usage/sessions.ts), which now comes solely from the apps.json
// registry, so every test needs claude/opencode seeded with the same home
// fields and usage formats as the real loader descriptors (loaders/*/plugin.json),
// matching the HUB_*_DIR overrides this file drives.
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

// buildSessionsWithCosts() is called with no args (real env/home), so the
// registry file also needs a stable, HUB_APPS_FILE-independent location; a
// fresh temp file per test keeps it isolated from the real ~/.config/forebay.
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vendor-usage-sessions-"));
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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

describe("buildSessionsWithCosts: opencode sqlite db", () => {
  it("aggregates tokens and model usage from db sessions and messages", async () => {
    const dbHome = join(tempDir, "db-home");
    mkdirSync(dbHome, { recursive: true });
    process.env.OPENCODE_DIR = dbHome;
    const db = new DatabaseSync(join(dbHome, "opencode.db"));
    db.exec(
      "CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)",
    );
    db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)");
    db.prepare("INSERT INTO session (id, parent_id, title, time_created, time_updated) VALUES (?, NULL, ?, ?, ?)").run(
      "sess1",
      "My Session",
      1700000000000,
      1700000100000,
    );
    const msg1 = {
      role: "assistant",
      modelID: "gpt-4",
      providerID: "openai",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 10, write: 5 } },
    };
    const msg2 = {
      role: "assistant",
      modelID: "gpt-4",
      providerID: "openai",
      tokens: { input: 20, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
      "m1",
      "sess1",
      1700000050000,
      JSON.stringify(msg1),
    );
    db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
      "m2",
      "sess1",
      1700000060000,
      JSON.stringify(msg2),
    );
    db.close();

    const sessions = await buildSessionsWithCosts();
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.id).toBe("sess1");
    expect(session.title).toBe("My Session");
    expect(session.source).toBe("opencode");
    expect(session.messageCount).toBe(2);
    expect(session.tokens).toEqual({ input: 120, output: 60, reasoning: 0, cacheRead: 10, cacheWrite: 5 });
    expect(session.modelUsage["gpt-4"]).toEqual({
      tokens: { input: 120, output: 60, reasoning: 0 },
      provider: "openai",
      count: 2,
    });
  });
});

describe("buildSessionsWithCosts: legacy opencode file storage", () => {
  it("reads session + message JSON files when no db is present", async () => {
    const opencodeHome = process.env.HUB_OPENCODE_DIR as string;
    const sessionDir = join(opencodeHome, "data", "storage", "session", "proj1");
    const messageDir = join(opencodeHome, "data", "storage", "message", "sess-legacy");
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(messageDir, { recursive: true });

    writeFileSync(
      join(sessionDir, "sess-legacy.json"),
      JSON.stringify({ id: "sess-legacy", title: "Legacy Session", time: { created: 1000, updated: 2000 } }),
    );
    writeFileSync(
      join(messageDir, "m1.json"),
      JSON.stringify({
        id: "m1",
        role: "assistant",
        modelID: "claude-3",
        providerID: "anthropic",
        tokens: { input: 40, output: 15, reasoning: 0, cache: { read: 1, write: 2 } },
        time: { created: 1500 },
      }),
    );

    const sessions = await buildSessionsWithCosts();
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.id).toBe("sess-legacy");
    expect(session.title).toBe("Legacy Session");
    expect(session.source).toBe("opencode");
    expect(session.messageCount).toBe(1);
    expect(session.tokens).toEqual({ input: 40, output: 15, reasoning: 0, cacheRead: 1, cacheWrite: 2 });
  });
});

describe("buildSessionsWithCosts: Claude Code JSONL wire-to-neutral token mapping", () => {
  it("maps Anthropic-wire usage fields onto the neutral tokens shape", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "-my-project");
    mkdirSync(projectDir, { recursive: true });

    const lines = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 50,
          },
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:01:00.000Z",
        message: {
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        },
      }),
    ];
    writeFileSync(join(projectDir, "session-abc.jsonl"), lines.join("\n"), "utf-8");

    const sessions = await buildSessionsWithCosts();
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.id).toBe("session-abc");
    expect(session.source).toBe("claude");
    expect(session.messageCount).toBe(2);
    // Anthropic wire names (input_tokens/output_tokens/cache_read_input_tokens/
    // cache_creation_input_tokens) must map onto the neutral internal shape.
    expect(session.tokens).toEqual({ input: 1010, output: 205, reasoning: 0, cacheRead: 300, cacheWrite: 50 });
    expect(session.modelUsage["claude-sonnet-5"]).toEqual({
      tokens: { input: 1010, output: 205, reasoning: 0 },
      provider: "anthropic",
      count: 2,
    });
  });

  // Every session in a project used to take the project's name, so a project with twenty
  // sessions rendered as twenty identical rows. The session's own first prompt tells them apart.
  it("titles a session from its own first prompt, keeping the project beside it", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "C--Users-jane-myapp");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "session-prompted.jsonl"),
      [
        JSON.stringify({ type: "user", message: { content: "Caveat: injected preamble" } }),
        JSON.stringify({ type: "user", message: { content: "<command-name>/init</command-name>" } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Fix   the login redirect" }] } }),
        JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:00.000Z", message: { model: "claude-sonnet-5", usage: { input_tokens: 5, output_tokens: 1 } } }),
      ].join(String.fromCharCode(10)),
      "utf-8",
    );

    const sessions = await buildSessionsWithCosts();
    expect(sessions[0].title).toBe("Fix the login redirect");
    expect(sessions[0].project).toBe("Users jane myapp");
  });

  it("truncates a long first prompt rather than rendering a whole paragraph", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "C--Users-jane-long");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "session-long.jsonl"),
      [
        JSON.stringify({ type: "user", message: { content: "word ".repeat(60) } }),
        JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:00.000Z", message: { model: "claude-sonnet-5", usage: { input_tokens: 1, output_tokens: 1 } } }),
      ].join(String.fromCharCode(10)),
      "utf-8",
    );

    const sessions = await buildSessionsWithCosts();
    const long = sessions.find((x) => x.project === "Users jane long");
    expect(long!.title.length).toBeLessThanOrEqual(80);
    expect(long!.title.endsWith("…")).toBe(true);
  });

  it("derives a friendly title from the project directory name", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "C--Users-jane-myapp");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "session-titled.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { model: "claude-sonnet-5", usage: { input_tokens: 5, output_tokens: 1 } },
      }),
      "utf-8",
    );

    const sessions = await buildSessionsWithCosts();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Users jane myapp");
  });

  it("ignores sessions with no assistant usage entries", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "-empty-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "session-empty.jsonl"), JSON.stringify({ type: "user" }), "utf-8");

    const sessions = await buildSessionsWithCosts();
    expect(sessions).toHaveLength(0);
  });
});

describe("buildSessionsWithCosts: Claude Code transcript caching", () => {
  it("serves an unchanged transcript from the per-file cache instead of re-reading", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "-cache-project");
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, "session-cached.jsonl");
    const entry = (input: number) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { model: "claude-sonnet-5", usage: { input_tokens: input, output_tokens: 1 } },
      });

    // Pin an explicit mtime so both writes carry an identical (mtime, size)
    // key; sub-millisecond stat precision would defeat a save-and-restore.
    const pinned = new Date("2026-01-02T03:04:05.000Z");
    writeFileSync(file, entry(1000), "utf-8");
    utimesSync(file, pinned, pinned);
    const first = await buildSessionsWithCosts();
    expect(first[0].tokens.input).toBe(1000);

    // Same byte length, different numbers, same mtime: an unchanged
    // (path, mtime, size) key must be served from the cache.
    writeFileSync(file, entry(2000), "utf-8");
    utimesSync(file, pinned, pinned);
    const second = await buildSessionsWithCosts();
    expect(second[0].tokens.input).toBe(1000);
  });

  it("re-reads a transcript whose mtime changed", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "-recheck-project");
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, "session-fresh.jsonl");
    const entry = (input: number) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { model: "claude-sonnet-5", usage: { input_tokens: input, output_tokens: 1 } },
      });

    writeFileSync(file, entry(1000), "utf-8");
    const first = await buildSessionsWithCosts();
    expect(first[0].tokens.input).toBe(1000);

    writeFileSync(file, entry(9999), "utf-8");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const second = await buildSessionsWithCosts();
    expect(second[0].tokens.input).toBe(9999);
  });

  it("parses CRLF transcripts via the streaming reader", async () => {
    const claudeHome = process.env.HUB_CLAUDE_DIR as string;
    const projectDir = join(claudeHome, "projects", "-crlf-project");
    mkdirSync(projectDir, { recursive: true });
    const lines = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { model: "claude-sonnet-5", usage: { input_tokens: 7, output_tokens: 3 } },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:01:00.000Z",
        message: { model: "claude-sonnet-5", usage: { input_tokens: 5, output_tokens: 2 } },
      }),
    ];
    writeFileSync(join(projectDir, "session-crlf.jsonl"), lines.join("\r\n") + "\r\n", "utf-8");

    const sessions = await buildSessionsWithCosts();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokens).toEqual({ input: 12, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    expect(sessions[0].messageCount).toBe(2);
  });
});

describe("buildModelSummary", () => {
  it("aggregates model usage across sessions", () => {
    const sessions: Session[] = [
      {
        id: "s1",
        title: "a",
        created: 1,
        updated: 2,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        modelUsage: {
          "model-a": { tokens: { input: 10, output: 5, reasoning: 0 }, provider: "p1", count: 2 },
        },
        costByDay: {},
        messageCount: 2,
        source: "opencode",
      },
      {
        id: "s2",
        title: "b",
        created: 3,
        updated: 4,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        modelUsage: {
          "model-a": { tokens: { input: 3, output: 1, reasoning: 0 }, provider: "p1", count: 1 },
          "model-b": { tokens: { input: 7, output: 2, reasoning: 1 }, provider: "p2", count: 1 },
        },
        costByDay: {},
        messageCount: 1,
        source: "claude",
      },
    ];

    const summary = buildModelSummary(sessions);
    expect(summary["model-a"]).toEqual({
      tokens: { input: 13, output: 6, reasoning: 0 },
      provider: "p1",
      sessionCount: 2,
      messageCount: 3,
    });
    expect(summary["model-b"]).toEqual({
      tokens: { input: 7, output: 2, reasoning: 1 },
      provider: "p2",
      sessionCount: 1,
      messageCount: 1,
    });
  });
});
