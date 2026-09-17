import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Counts files under a directory, recursively. Used to prove Forebay actually wrote
 * into the sandboxed store dir, rather than merely having it configured.
 */
export function countFilesUnder(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) count += countFilesUnder(full);
    else count += 1;
  }
  return count;
}

/** Polls rather than checking once: the write this proves is async, fired from the
 * renderer's first plugin-screens fetch rather than from anything this harness awaits. */
export async function waitForFileUnder(dir: string, timeoutMs = 10000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let count = countFilesUnder(dir);
  while (count === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    count = countFilesUnder(dir);
  }
  return count;
}

export function listFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFilesUnder(full));
    else out.push(full);
  }
  return out;
}
