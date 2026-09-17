import { drainHomes, type EventEnvelope } from "@intisy-ai/basekit";
import type { Result, BusEvent, PluginHome } from "../../../packages/shared/src/domain.js";
import { pluginHomes } from "../lib/pluginHomes.js";
import { wrap } from "../result.js";

const CONSUMER_ID = "forebay-ui";

export interface BusDeps {
  homes?: () => Promise<PluginHome[]>;
  drain?: (homes: string[], consumerId: string, handler: (e: EventEnvelope) => void) => number;
}

// Cursor-based catch-up read across every present home's bus. Each call returns
// only events published since the last call (the cursor advances per home), so a
// renderer can poll this to stay in step with config/sync activity.
export function busDrain(deps: BusDeps = {}): Promise<Result<BusEvent[]>> {
  const listHomes = deps.homes ?? pluginHomes;
  const drain = deps.drain ?? drainHomes;
  return wrap(async () => {
    const dirs = (await listHomes()).filter((h) => h.present).map((h) => h.dir);
    const events: BusEvent[] = [];
    drain(dirs, CONSUMER_ID, (e) => events.push({ topic: e.topic, source: e.source, ts: e.ts, payload: e.payload }));
    return events;
  });
}
