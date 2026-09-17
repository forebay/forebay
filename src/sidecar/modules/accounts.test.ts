import { describe, it, expect, beforeEach } from "vitest";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeLibraries } from "@intisy-ai/basekit";

const stubHandlerPath = fileURLToPath(new URL("../../../../../plugins/providers/stub-auth/dist/handler.js", import.meta.url));

beforeEach(() => {
  process.env.HUB_CONFIG_DIR = mkdtempSync(join(tmpdir(), "dash-accounts-"));
});

const stubCloneDir = fileURLToPath(new URL("../../../../../plugins/providers/stub-auth", import.meta.url));
const stubIsCheckedOut = existsSync(stubHandlerPath);

// Stands in for `npm install --prefix <home>`, copying out of the sibling checkouts this
// workspace already has rather than reaching the registry.
function localInstaller(configDir: string): void {
  const manifest = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  for (const specifier of Object.keys(manifest.dependencies ?? {})) {
    const from = join(stubCloneDir, "node_modules", ...specifier.split("/"));
    if (!existsSync(from)) continue;
    cpSync(from, join(configDir, "node_modules", ...specifier.split("/")), { recursive: true });
  }
}

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
  // A provider's bundle imports its libraries by name rather than inlining them, so a
  // home without the shared store cannot load one. Installing materialises the store;
  // seeding a home by hand has to do the same or this tests a state that never exists.
  materializeLibraries(stubCloneDir, configDir, () => {}, localInstaller);
}

function seedProvider(repo: string, providerId: string, handlerSource: string): void {
  const configDir = process.env.HUB_CONFIG_DIR as string;
  const repoDir = join(configDir, "repos", repo);
  mkdirSync(join(repoDir, "dist"), { recursive: true });
  writeFileSync(
    join(repoDir, "package.json"),
    JSON.stringify({
      name: repo,
      claudeHub: { authProviders: [{ name: providerId, handler: "dist/handler.js" }] },
    }),
  );
  writeFileSync(join(repoDir, "dist", "handler.js"), handlerSource);
}

// Simulates a provider bundled with its own copy of core-auth: the thrown error
// is a plain Error with name "LockTimeoutError", not an instance of the
// dashboard's own LockTimeoutError class, since esbuild gives each provider
// bundle its own class identity for the same error type.
function seedLockedProvider(): void {
  seedProvider(
    "locked-auth",
    "locked",
    `export const accounts = {
      list() {
        const e = new Error("store busy");
        e.name = "LockTimeoutError";
        throw e;
      },
      enable() {},
      remove() {},
    };
`,
  );
}

// A plugin installed but never fully built: its entry file is on disk, the library
// that file imports is not.
function seedUnloadableProvider(): void {
  seedProvider("broken-auth", "broken", `import "./never-built-library.js";\n`);
}

function seedControllerlessProvider(): void {
  seedProvider("routing-only", "controllerless", `export const def = { id: "controllerless", label: "Routing Only" };\n`);
}

describe("accounts sidecar module", () => {
// The sibling provider checkout is there in the workspace and absent when this repo is cloned on
// its own, which is what CI does. Skipped rather than failed there: a deployed provider bundle is
// what this asserts against, and no stand-in would be asserting the same thing.
  it.skipIf(!stubIsCheckedOut)("lists, enables, and removes accounts via the provider's controller", async () => {
    seedStubProvider();
    const { addAccount } = await import("@intisy-ai/basekit/auth");
    addAccount("stub", { id: "a1", email: "a1@example.com", refresh: "r1", enabled: true });
    addAccount("stub", { id: "a2", email: "a2@example.com", refresh: "r2", enabled: true });

    const { accountsList, accountsEnable, accountsRemove } = await import("./accounts.js");

    const listed = await accountsList("stub");
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error("unreachable");
    expect(listed.data).toHaveLength(2);
    expect([...listed.data].map((a) => a.id).sort()).toEqual(["a1", "a2"]);

    const disabled = await accountsEnable("stub", "a1", false);
    expect(disabled.ok).toBe(true);
    const afterDisable = await accountsList("stub");
    if (!afterDisable.ok) throw new Error("unreachable");
    expect(afterDisable.data.find((a) => a.id === "a1")?.enabled).toBe(false);

    const removed = await accountsRemove("stub", "a2");
    expect(removed.ok).toBe(true);
    const afterRemove = await accountsList("stub");
    if (!afterRemove.ok) throw new Error("unreachable");
    expect(afterRemove.data).toHaveLength(1);
    expect(afterRemove.data[0].id).toBe("a1");
  });

  it("returns ok:false when the provider cannot be resolved", async () => {
    const { accountsList } = await import("./accounts.js");
    const result = await accountsList("nonexistent-provider");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("no provider deployed");
  });

  it("blames the failed bundle, not a missing controller, when the handler cannot be imported", async () => {
    seedUnloadableProvider();
    const { accountsList } = await import("./accounts.js");

    const result = await accountsList("broken");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("broken-auth failed to load");
    expect(result.error).toMatch(/never-built-library/);
  });

  it("says the plugin manages no accounts when its handler loads without a controller", async () => {
    seedControllerlessProvider();
    const { accountsList } = await import("./accounts.js");

    const result = await accountsList("controllerless");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("manages no accounts");
  });

  it("maps a cross-bundle LockTimeoutError (matched by name, not class identity) to the locked-store message", async () => {
    seedLockedProvider();
    const { accountsList } = await import("./accounts.js");

    const result = await accountsList("locked");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("account store is locked");
  });
});
