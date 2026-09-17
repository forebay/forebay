import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "forebay.json";
const LEGACY_CONFIG_FILE = "cairn.json";

/**
 * Carries this app's stored settings across the rename that gave it its current name.
 *
 * @remarks
 * The settings file is named after the app, so without this a rename would present a first run to
 * someone who has years of GitHub accounts, favourites and a chosen local API port. Renaming rather
 * than copying is deliberate: two files would diverge on the next write and the loser would be
 * whichever build ran last. It is checked on every start rather than once, because the store
 * directory is chosen at launch and a home that has never been opened since the rename can appear
 * at any time.
 *
 * @param storeDir the store directory this process was launched against.
 * @returns true when a legacy settings file was carried across.
 */
export function migrateLegacySettings(storeDir: string): boolean {
  const current = join(storeDir, "config", CONFIG_FILE);
  const legacy = join(storeDir, "config", LEGACY_CONFIG_FILE);
  if (existsSync(current) || !existsSync(legacy)) return false;
  try {
    renameSync(legacy, current);
    return true;
  } catch {
    return false;
  }
}
