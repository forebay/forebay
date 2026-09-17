// What the dashboard itself reports. Its records live in the dashboard's own home
// (already stated as the activity context at sidecar startup) and name the home they
// affected as the target, resolved the one way pluginHomes resolves a home.
import { emitEvent } from "@intisy-ai/basekit";
import type { Impact } from "@intisy-ai/basekit";
import { pluginHomes, homeDir } from "./lib/pluginHomes.js";
import type { PluginHome, PluginHomeId } from "../../packages/shared/src/domain.js";

const SOURCE = "forebay";

export interface ForebayActionSpec {
  action: string;
  subject: { kind: string; id: string; label?: string };
  homeId?: string;
  outcome?: "ok" | "failed";
  impact?: Impact;
  topic?: string;
  details?: Record<string, unknown>;
}

async function targetFor(homeId: string | undefined, homes?: PluginHome[]): Promise<{ home: string } | undefined> {
  if (!homeId) return undefined;
  try {
    // emitEvent drops a target that only repeats the origin's home, so an action on the
    // dashboard's own home needs no special case here.
    return { home: homeDir(homeId as PluginHomeId, homes ?? (await pluginHomes())) };
  } catch {
    return undefined;
  }
}

export async function emitForebayAction(spec: ForebayActionSpec, homes?: PluginHome[]): Promise<void> {
  try {
    emitEvent({
      topic: spec.topic ?? "plugin.state",
      action: spec.action,
      actor: "user",
      impact: spec.impact ?? "notice",
      outcome: spec.outcome ?? "ok",
      subject: spec.subject,
      target: await targetFor(spec.homeId, homes),
      details: spec.details ?? {},
    }, SOURCE);
  } catch { /* a dashboard action must not fail because it could not be recorded */ }
}
