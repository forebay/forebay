import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readDeployedProviders } from "@intisy-ai/basekit/loader/loader-runtime.js";
import { reposDir, getConfigDir } from "@intisy-ai/basekit/auth";

export interface DeployedHandler {
  repo: string;
  module: Record<string, unknown>;
}

// Node keys its ESM registry by URL and keeps the entry for the life of the process, a
// failed load included. Repairing a provider therefore changed nothing until Forebay was
// restarted: the next import replayed the cached failure. Stamping the bundle's mtime into
// the URL makes a rebuilt bundle a different module while an untouched one still hits the
// cache.
function handlerUrl(handlerPath: string): string {
  const url = pathToFileURL(handlerPath);
  try {
    url.searchParams.set("mtime", String(statSync(handlerPath).mtimeMs));
  } catch { /* the import below reports a missing file better than this could */ }
  return url.href;
}

// Node's own ERR_MODULE_NOT_FOUND formatting can throw while building its message, which
// surfaces as an internals complaint about argument counts and buries the real cause. The
// code alone is the reliable part, so it leads.
function reasonOf(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ERR_MODULE_NOT_FOUND") return "a module it imports is missing (the plugin needs repairing)";
  return code ? `${code}: ${message}` : message;
}

// Imports a deployed plugin's handler bundle, throwing a message that names what actually
// went wrong. Every caller used to catch this failure and report its own unrelated cause (a
// provider labelled with its raw id, a missing accounts controller, a provider that "does
// not support in-app login", an empty list of wire formats), which made one broken install
// look like several unrelated bugs.
export async function importHandlerModule(handlerPath: string, repo: string): Promise<Record<string, unknown>> {
  try {
    return await import(handlerUrl(handlerPath));
  } catch (e) {
    throw new Error(`${repo} failed to load: ${reasonOf(e)}`);
  }
}

export async function importProviderHandler(provider: string): Promise<DeployedHandler> {
  const deployed = readDeployedProviders(reposDir(), getConfigDir()).find((p) => p.provider === provider);
  if (!deployed) throw new Error(`no provider deployed with id: ${provider}`);
  return { repo: deployed.repo, module: await importHandlerModule(deployed.handlerPath, deployed.repo) };
}
