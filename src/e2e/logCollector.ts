import type { _electron } from "@playwright/test";

export type LogSource = "console" | "pageerror" | "main" | "sidecar";

export interface LogEvent {
  source: LogSource;
  level: string;
  text: string;
}

type SandboxedElectronApp = Awaited<ReturnType<typeof _electron.launch>>;
type SandboxedPage = Awaited<ReturnType<SandboxedElectronApp["firstWindow"]>>;

/**
 * @implNote Sidecar stdout/stderr is piped through the main process's own console
 * (see src/main/sidecar/supervisor.ts), so a "[sidecar]" prefix on either main stream
 * is how a sidecar crash would surface; without capturing it here it is undiagnosable.
 */
function classify(line: string): LogSource {
  return line.startsWith("[sidecar]") ? "sidecar" : "main";
}

export function attachLogCollector(app: SandboxedElectronApp, page: SandboxedPage): LogEvent[] {
  const events: LogEvent[] = [];

  page.on("console", (message) => {
    events.push({ source: "console", level: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    events.push({ source: "pageerror", level: "error", text: error.message });
  });

  const proc = app.process();
  proc.stdout?.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      events.push({ source: classify(line), level: "log", text: line });
    }
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      events.push({ source: classify(line), level: "error", text: line });
    }
  });

  return events;
}

// Playwright's Electron support attaches a Node debugger to the main process (so
// `electronApp.evaluate()` can run there); these two exact lines are Node's own
// diagnostics when that inspector session ends, not anything Forebay's code prints.
// Anchored start-to-end on the literal message shape so a real error cannot hide
// behind a loose match (see logCollector.test.ts for the adversarial proof).
const PLAYWRIGHT_INSPECTOR_DETACH_LINES: readonly RegExp[] = [
  /^Debugger ending on ws:\/\/[^\s]+$/,
  /^For help, see: https:\/\/nodejs\.org\/en\/docs\/inspector$/,
];

export function isPlaywrightInspectorArtifact(text: string): boolean {
  return PLAYWRIGHT_INSPECTOR_DETACH_LINES.some((pattern) => pattern.test(text));
}

/**
 * Every renderer console error, every uncaught page error, every main-process stderr
 * line (other than Playwright's own inspector-detach diagnostics), and every
 * "[sidecar]" line at all (not just its error-level ones) count as a failure: the
 * harness must stay honest about anything unexpected, per how quiet the sidecar is
 * expected to be in normal operation.
 */
export function failuresIn(events: LogEvent[]): LogEvent[] {
  return events.filter(
    (event) =>
      event.source === "pageerror"
      || event.source === "sidecar"
      || (event.source === "console" && event.level === "error")
      || (event.source === "main" && event.level === "error" && !isPlaywrightInspectorArtifact(event.text)),
  );
}
