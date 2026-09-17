import type { AccountStatus, AccountView } from "@forebay/shared";

// Duplicated from StatusPill's module context: a plain .ts file can't import a
// type from a .svelte file's module block through tsc's project build.
type StatusVariant = "good" | "warn" | "off";

const STATUS_INFO: Record<AccountStatus, { variant: StatusVariant; label: string }> = {
  active: { variant: "good", label: "Active" },
  "rate-limited": { variant: "warn", label: "Rate limited" },
  "cooling-down": { variant: "warn", label: "Cooling down" },
  "verification-required": { variant: "warn", label: "Verification required" },
  disabled: { variant: "off", label: "Disabled" },
};

export function accountStatusInfo(account: AccountView): { variant: StatusVariant; label: string } {
  return STATUS_INFO[account.status];
}

export function accountLabel(account: AccountView): string {
  return account.email ?? account.id;
}
