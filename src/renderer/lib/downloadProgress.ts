import { forebay } from "./ipc.js";
import { setStep } from "./downloads.js";

// Feeds pushed install-progress events into the matching download task's step.
export function watchDownloadProgress(): () => void {
  return forebay.onDownloadProgress((progress) => setStep(progress.id, progress.step, progress.percent));
}
