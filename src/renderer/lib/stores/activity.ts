import { writable } from "svelte/store";
import { forebay } from "../ipc.js";

// Counts error-impact activity records seen since the Activity screen was last
// opened. Wired once at app startup (App.svelte) so the sidebar badge stays
// current while the user is on a different screen.
export const unseenErrorCount = writable(0);

// True while the Activity screen itself is the active route: the user is
// already looking at errors there, so they should never count as "unseen".
let active = false;

export function watchActivityErrors(): () => void {
  return forebay.onActivityEvent((record) => {
    if (record.impact === "error" && !active) unseenErrorCount.update((n) => n + 1);
  });
}

export function setActivityActive(value: boolean): void {
  active = value;
  if (value) clearUnseenErrors();
}

export function clearUnseenErrors(): void {
  unseenErrorCount.set(0);
}
