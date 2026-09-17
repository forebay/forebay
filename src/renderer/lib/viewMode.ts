import { forebay } from "./ipc.js";

export type ViewMode = "list" | "grid";

function keyFor(screen: string): string {
  return "viewMode." + screen;
}

// Once read, a screen's mode is answered without a round trip: revisiting a screen must not
// paint the default view first and swap to the stored one a frame later.
const known = new Map<string, ViewMode>();

export function knownViewMode(screen: string): ViewMode | null {
  return known.get(screen) ?? null;
}

export async function loadViewMode(screen: string): Promise<ViewMode> {
  try {
    const result = await forebay.getConfig("forebay", keyFor(screen));
    const mode: ViewMode = result.ok && result.data === "grid" ? "grid" : "list";
    known.set(screen, mode);
    return mode;
  } catch {
    return "list";
  }
}

export async function saveViewMode(screen: string, mode: ViewMode): Promise<void> {
  known.set(screen, mode);
  try {
    await forebay.setConfig("forebay", keyFor(screen), mode);
  } catch {
    // preference persistence is best-effort
  }
}

export function resetViewModeForTests(): void {
  known.clear();
}
