import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = join("workspace", "workspace.json");

function workspaceRoot(): string | undefined {
  for (let folder = dirname(fileURLToPath(import.meta.url)); ; folder = dirname(folder)) {
    if (existsSync(join(folder, MANIFEST))) return folder;
    if (dirname(folder) === folder) return undefined;
  }
}

/** A repo's checkout found through the workspace manifest, undefined outside a workspace. */
export function workspaceRepo(name: string): string | undefined {
  const root = workspaceRoot();
  if (root === undefined) return undefined;
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8")) as { repos: Array<{ path: string; remote: string }> };
  const entry = manifest.repos.find((repo) => repo.remote.split("/").at(-1) === name);
  return entry === undefined ? undefined : join(root, entry.path);
}
