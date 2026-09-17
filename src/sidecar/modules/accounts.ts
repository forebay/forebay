import type { AccountController } from "@intisy-ai/basekit/auth";
import type { AccountView, Result } from "../../../packages/shared/src/domain.js";
import { importProviderHandler } from "../lib/providerHandler.js";
import { ok, err } from "../result.js";
import { emitForebayAction } from "../activity.js";

async function guarded<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof Error && e.name === "LockTimeoutError") return err(`account store is locked: ${e.message}`);
    return err(e instanceof Error ? e.message : String(e));
  }
}

async function requireController(provider: string): Promise<AccountController> {
  const { repo, module } = await importProviderHandler(provider);
  const controller = module.accounts as AccountController | undefined;
  if (!controller) throw new Error(`${repo} manages no accounts for provider: ${provider}`);
  return controller;
}

export function accountsList(provider: string): Promise<Result<AccountView[]>> {
  return guarded(async () => (await requireController(provider)).list());
}

export function accountsEnable(provider: string, id: string, on: boolean): Promise<Result<void>> {
  return guarded(async () => {
    (await requireController(provider)).enable(id, on);
    await emitForebayAction({
      action: on ? "account_enabled" : "account_disabled",
      subject: { kind: "account", id, label: id },
      topic: "account.state",
      details: { provider, message: `${on ? "Enabled" : "Disabled"} ${id} (${provider})` },
    });
  });
}

export function accountsRemove(provider: string, id: string): Promise<Result<void>> {
  return guarded(async () => {
    (await requireController(provider)).remove(id);
  });
}

export function accountsRefreshQuota(provider: string): Promise<Result<AccountView[]>> {
  return guarded(async () => {
    const controller = await requireController(provider);
    if (controller.refreshQuota) await controller.refreshQuota();
    return controller.list();
  });
}
