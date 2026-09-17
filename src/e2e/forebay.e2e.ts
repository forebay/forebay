import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { launchSandboxedApp, repoRoot } from "./launchApp.js";
import type { SandboxedApp } from "./launchApp.js";
import { attachLogCollector, failuresIn } from "./logCollector.js";
import type { LogEvent } from "./logCollector.js";
import { snapshotRealHome, sameSnapshot } from "./homeSnapshot.js";
import { waitForFileUnder, listFilesUnder } from "./storeDirProof.js";
import { SCREENS } from "../renderer/lib/router.js";

type SandboxedPage = Awaited<ReturnType<SandboxedApp["app"]["firstWindow"]>>;

interface ScreenResult {
  id: string;
  label: string;
  status: "rendered" | "failed";
  detail?: string;
}

const SHOTS_DIR = join(repoRoot, "out", "e2e-shots");

describe("Forebay end-to-end", () => {
  let sandbox: SandboxedApp;
  let page: SandboxedPage;
  let events: LogEvent[];
  const screenResults: ScreenResult[] = [];

  // Taken before launch, read-only: the isolation levers under test protect exactly these two homes.
  const beforeClaude = snapshotRealHome(".claude");
  const beforeOpencode = snapshotRealHome(".config", "opencode");

  beforeAll(async () => {
    rmSync(SHOTS_DIR, { recursive: true, force: true });
    mkdirSync(SHOTS_DIR, { recursive: true });

    sandbox = await launchSandboxedApp();
    const window = await sandbox.app.firstWindow();
    events = attachLogCollector(sandbox.app, window);
    page = window;
    await page.waitForSelector("h1", { timeout: 30000 });
  });

  afterAll(async () => {
    console.log("[forebay-e2e] per-screen results:", JSON.stringify(screenResults, null, 2));
    console.log("[forebay-e2e] captured log events:", JSON.stringify(events, null, 2));
    await sandbox?.dispose();
  });

  it("points every isolation lever inside the temp dir before launch", () => {
    expect(sandbox.env.APPDATA.startsWith(sandbox.tempDir)).toBe(true);
    expect(sandbox.env.HUB_APPS_FILE.startsWith(sandbox.tempDir)).toBe(true);
    for (const homeDir of Object.values(sandbox.homeDirs)) {
      expect(homeDir.startsWith(sandbox.tempDir)).toBe(true);
    }
  });

  it("renders the 12 always-visible sidebar screens with a matching heading, no thrown errors", async () => {
    for (const screen of SCREENS) {
      const button = page.locator(`button[title="${screen.label}"]`);
      try {
        await button.waitFor({ state: "visible", timeout: 5000 });
        await button.click();
        await page.waitForFunction(
          (label) => document.querySelector("h1")?.textContent?.trim() === label,
          screen.label,
          { timeout: 15000 },
        );
        const subtitle = (await page.locator(".bsub").textContent())?.trim();
        const routeErrorCount = await page.locator(".route-error").count();
        await page.screenshot({ path: join(SHOTS_DIR, `${screen.id}.png`) }).catch(() => {});
        if (subtitle !== screen.label) throw new Error(`titlebar subtitle "${subtitle}" did not become "${screen.label}"`);
        if (routeErrorCount > 0) throw new Error("route failed to load: .route-error is present");
        screenResults.push({ id: screen.id, label: screen.label, status: "rendered" });
      } catch (error) {
        await page.screenshot({ path: join(SHOTS_DIR, `${screen.id}-failure.png`) }).catch(() => {});
        screenResults.push({
          id: screen.id,
          label: screen.label,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failed = screenResults.filter((result) => result.status === "failed");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it("shows the routing screen's empty state when no proxy plugin is installed", async () => {
    await page.locator('button[title="Routing"]').click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent?.trim() === "Routing",
      { timeout: 15000 },
    );

    const message = (await page.locator(".empty .msg").textContent())?.trim();
    expect(message).toBe("Install a proxy in Plugins to configure routing.");

    const browseProxiesButton = page.locator(".empty button", { hasText: "Browse proxies" });
    expect(await browseProxiesButton.count()).toBe(1);
    expect(await browseProxiesButton.isVisible()).toBe(true);
  });

  it("writes into the sandboxed store dir rather than merely having it configured", async () => {
    const fileCount = await waitForFileUnder(sandbox.storeDir);
    console.log("[forebay-e2e] files written under sandboxed store dir:", listFilesUnder(sandbox.storeDir));
    expect(fileCount).toBeGreaterThan(0);
  });

  // Disposing here, before the last two checks, means both cover the full process
  // lifetime including shutdown, rather than only the interactive portion of the run.
  it("raised zero console errors, page errors, main-stderr lines, or sidecar lines", async () => {
    await sandbox.dispose();
    const failed = failuresIn(events);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it("never touched the real ~/.claude or ~/.config/opencode homes", async () => {
    await sandbox.dispose();
    const afterClaude = snapshotRealHome(".claude");
    const afterOpencode = snapshotRealHome(".config", "opencode");
    expect(sameSnapshot(beforeClaude, afterClaude)).toBe(true);
    expect(sameSnapshot(beforeOpencode, afterOpencode)).toBe(true);
  });
});
