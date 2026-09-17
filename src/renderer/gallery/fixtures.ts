import type { AccountQuota, AccountView, ActivityRecord, CairnAPI, HomePlugins, HostApp, PluginConfigSchema, PluginHome, ProviderRow, UnifiedPlugin } from "@cairn/shared";

export const HOST_APPS: HostApp[] = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
];

export const QUOTA: AccountQuota[] = [
  { label: "fast", remainingFraction: 0.72 },
  { label: "deep", remainingFraction: 0.14 },
  { label: "batch", remainingFraction: 1 },
  { label: "spare", remainingFraction: 0.5 },
];

export const STATUS = {
  good: { variant: "good", label: "Signed in" },
  warn: { variant: "warn", label: "Quota low" },
  off: { variant: "off", label: "Disabled" },
} as const;

export const LOREM =
  "Routes requests to a vendor endpoint and reports quota back to the control plane.";

export const LONG_NAME = "a-very-long-plugin-name-that-has-to-truncate-somewhere";

const HOME_ALPHA: PluginHome = { id: "alpha", label: "Alpha", dir: "/alpha", present: true, managesPlugins: true };
const HOME_BETA: PluginHome = { id: "beta", label: "Beta", dir: "/beta", present: true, managesPlugins: true };

function home(id: string, label: string): PluginHome {
  return { id, label, dir: `/${id}`, present: true, managesPlugins: true };
}

const SECTIONS: HomePlugins[] = [
  { home: home("alpha", "Alpha"), rows: [
    { name: "wakatime-sync", kind: "git", present: true, enabled: true, updateAvailable: false, installedVersion: "1.4.0", description: "Reports coding activity to WakaTime." },
    { name: "config-ledger", kind: "git", present: true, enabled: true, updateAvailable: true, installedVersion: "3.0.2", description: "Keeps every home's config in one git repo." },
  ] },
  { home: home("beta", "Beta"), rows: [
    { name: "wakatime-sync", kind: "git", present: true, enabled: false, updateAvailable: false, installedVersion: "1.4.0", description: "Reports coding activity to WakaTime." },
  ] },
];

const CATALOG = [
  { name: "wakatime-sync", url: "https://example/wakatime-sync", kind: "plugin" as const, description: "Reports coding activity to WakaTime.", deprecated: false, topics: ["plugin", "metrics"], sourceId: "forebay" },
  { name: "config-ledger", url: "https://example/config-ledger", kind: "plugin" as const, description: "Keeps every home's config in one git repo.", deprecated: false, topics: ["plugin", "git"], sourceId: "forebay" },
  { name: "antigravity-auth", url: "https://example/antigravity-auth", kind: "provider" as const, description: LOREM, deprecated: false, topics: ["provider", "gemini"], sourceId: "forebay" },
  { name: LONG_NAME, url: "https://example/long", kind: "plugin" as const, description: LOREM, deprecated: true, topics: ["plugin"], sourceId: "forebay" },
  { name: "demo-provider", url: "https://example/demo-provider", kind: "provider" as const, description: "A provider from a second marketplace.", deprecated: false, topics: ["ai-provider"], sourceId: "demo" },
  { name: "openai-translator", url: "https://example/openai-translator", kind: "translator" as const, description: "Translates the OpenAI wire format to the canonical IR.", deprecated: false, topics: ["vendor-translator", "openai"], sourceId: "forebay" },
  { name: "gemini-translator", url: "https://example/gemini-translator", kind: "translator" as const, description: "Translates the Gemini wire format to the canonical IR.", deprecated: false, topics: ["vendor-translator", "gemini"], sourceId: "forebay" },
];

// What custom-auth's manifest declares: a category selected by TOPIC, so a translator
// published later joins it without custom-auth changing.
const CONTRIBUTIONS = [
  { id: "translators", label: "Translators", match: { topics: ["vendor-translator"] }, contributedBy: "custom-auth" },
];

// One healthy source and one that failed, which is the state the screen has to render
// without losing the entries the healthy one returned.
const CATALOG_SOURCES = [
  { id: "forebay", label: "forebay", type: "github-org" as const, ok: true, entryCount: 4 },
  { id: "demo", label: "Demo", type: "local" as const, ok: true, entryCount: 1, shadowed: [{ name: "wakatime-sync", by: "forebay" }] },
  { id: "acme", label: "Acme", type: "manifest" as const, ok: false, entryCount: 0, error: "http 404" },
];

// The real marks antigravity-auth ships, so the gallery shows the resolution chain rather
// than a row of lettermarks: the provider's own mark, its plugin's, then nothing.
const ANTIGRAVITY_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjggNiAxMDAgMTAwIiBmaWxsPSJub25lIj48cmVjdCB4PSI4IiB5PSI2IiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjE2IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTg5LjY5OTIgOTMuNjk1Qzk0LjM2NTkgOTcuMTk1IDEwMS4zNjYgOTQuODYxNyA5NC45NDkyIDg4LjQ0NUM3NS42OTkyIDY5Ljc3ODMgNzkuNzgyNSAxOC40NDUgNTUuODY1OSAxOC40NDVDMzEuOTQ5MiAxOC40NDUgMzYuMDMyNSA2OS43NzgzIDE2Ljc4MjUgODguNDQ1QzkuNzgyNTEgOTUuNDQ1IDE3LjM2NTggOTcuMTk1IDIyLjAzMjUgOTMuNjk1QzQwLjExNTkgODEuNDQ1IDM4Ljk0OTIgNTkuODYxNyA1NS44NjU5IDU5Ljg2MTdDNzIuNzgyNSA1OS44NjE3IDcxLjYxNTkgODEuNDQ1IDg5LjY5OTIgOTMuNjk1WiIgZmlsbD0iIzMxODZGRiIvPjxtYXNrIGlkPSJhZ21hc2siIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9IjEzIiB5PSIxOCIgd2lkdGg9Ijg1IiBoZWlnaHQ9Ijc4IiBzdHlsZT0ibWFzay10eXBlOiBhbHBoYTsiPjxwYXRoIGQ9Ik04OS42OTkyIDkzLjY5NUM5NC4zNjU5IDk3LjE5NSAxMDEuMzY2IDk0Ljg2MTcgOTQuOTQ5MiA4OC40NDVDNzUuNjk5MiA2OS43NzgzIDc5Ljc4MjUgMTguNDQ1IDU1Ljg2NTkgMTguNDQ1QzMxLjk0OTIgMTguNDQ1IDM2LjAzMjUgNjkuNzc4MyAxNi43ODI1IDg4LjQ0NUM5Ljc4MjUxIDk1LjQ0NSAxNy4zNjU4IDk3LjE5NSAyMi4wMzI1IDkzLjY5NUM0MC4xMTU5IDgxLjQ0NSAzOC45NDkyIDU5Ljg2MTcgNTUuODY1OSA1OS44NjE3QzcyLjc4MjUgNTkuODYxNyA3MS42MTU5IDgxLjQ0NSA4OS42OTkyIDkzLjY5NVoiIGZpbGw9ImJsYWNrIi8+PC9tYXNrPjxnIG1hc2s9InVybCgjYWdtYXNrKSI+PGcgZmlsdGVyPSJ1cmwoI2YwKSI+PGVsbGlwc2UgY3g9IjIyLjc4NzMiIGN5PSIyNi44MDk4IiByeD0iMjIuNzg3MyIgcnk9IjI2LjgwOTgiIHRyYW5zZm9ybT0ibWF0cml4KC0wLjExMjc4NCAwLjk5MzYyIC0wLjk5MzYyIC0wLjExMjc4MSA2Ni4yNDczIC0xNS41MzQ0KSIgZmlsbD0iI0ZGRTQzMiIvPjwvZz48ZyBmaWx0ZXI9InVybCgjZjEpIj48ZWxsaXBzZSBjeD0iOTYuNDkxIiBjeT0iMzUuMTIzMSIgcng9IjI5LjUwMDciIHJ5PSIzMC4xNDkyIiB0cmFuc2Zvcm09InJvdGF0ZSg3Ni45MjQzIDk2LjQ5MSAzNS4xMjMxKSIgZmlsbD0iI0ZDNDEzRCIvPjwvZz48ZyBmaWx0ZXI9InVybCgjZjIpIj48ZWxsaXBzZSBjeD0iOS4wMjk4OCIgY3k9IjQxLjY2NDciIHJ4PSIzMC44MzIiIHJ5PSIzOS45NDE3IiB0cmFuc2Zvcm09InJvdGF0ZSg3NC4xMjU3IDkuMDI5ODggNDEuNjY0NykiIGZpbGw9IiMwMEI5NUMiLz48L2c+PGcgZmlsdGVyPSJ1cmwoI2Y0KSI+PGVsbGlwc2UgY3g9IjExLjIyMTIiIGN5PSI0Mi44OTE1IiByeD0iMzAuMjIiIHJ5PSIzMy4yNjk1IiB0cmFuc2Zvcm09InJvdGF0ZSg0NS42MDY1IDExLjIyMTIgNDIuODkxNSkiIGZpbGw9IiMwMEI5NUMiLz48L2c+PGcgZmlsdGVyPSJ1cmwoI2Y1KSI+PGVsbGlwc2UgY3g9Ijc1Ljc1NDYiIGN5PSIxMDQuODIyIiByeD0iMjkuMDE3NyIgcnk9IjI3Ljk0MyIgdHJhbnNmb3JtPSJyb3RhdGUoNzYuOTI0MyA3NS43NTQ2IDEwNC44MjIpIiBmaWxsPSIjMzE4NkZGIi8+PC9nPjxnIGZpbHRlcj0idXJsKCNmNikiPjxlbGxpcHNlIGN4PSIzMy41NjYxIiBjeT0iMzUuNDA0MyIgcng9IjMzLjU2NjEiIHJ5PSIzNS40MDQzIiB0cmFuc2Zvcm09Im1hdHJpeCgtMC40MDk1MzkgMC45MTIyOTMgLTAuOTEyMjk0IC0wLjQwOTUzNyAxMDEuMjUgLTE1LjE2NzQpIiBmaWxsPSIjRkJCQzA0Ii8+PC9nPjxnIGZpbHRlcj0idXJsKCNmOSkiPjxlbGxpcHNlIGN4PSI5Mi42MTEiIGN5PSIyMy43OTYyIiByeD0iNDQuMjQxMSIgcnk9IjI3LjUwMTYiIHRyYW5zZm9ybT0icm90YXRlKDM0LjA3NjMgOTIuNjExIDIzLjc5NjIpIiBmaWxsPSIjRkM0MTNEIi8+PC9nPjxnIGZpbHRlcj0idXJsKCNmMTApIj48ZWxsaXBzZSBjeD0iMjMuNDk0OSIgY3k9IjI5LjU4ODciIHJ4PSIyMy43MDcxIiByeT0iMTMuNzg2OSIgdHJhbnNmb3JtPSJyb3RhdGUoMTEyLjUxNiAyMy40OTQ5IDI5LjU4ODcpIiBmaWxsPSIjRkZFRTQ4Ii8+PC9nPjwvZz48ZGVmcz48ZmlsdGVyIGlkPSJmMCIgeD0iMi40OTM0OCIgeT0iLTI2LjU0MjMiIHdpZHRoPSI2OS4wODk5IiBoZWlnaHQ9IjYxLjI1MjUiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIzLjg5MDM0IiByZXN1bHQ9ImIiLz48L2ZpbHRlcj48ZmlsdGVyIGlkPSJmMSIgeD0iMjguNzUyNCIgeT0iLTMyLjAzMzMiIHdpZHRoPSIxMzUuNDc3IiBoZWlnaHQ9IjEzNC4zMTMiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIxOC44MDc4IiByZXN1bHQ9ImIiLz48L2ZpbHRlcj48ZmlsdGVyIGlkPSJmMiIgeD0iLTYyLjI4ODQiIHk9Ii0yMS45MjUzIiB3aWR0aD0iMTQyLjYzNyIgaGVpZ2h0PSIxMjcuMTgiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIxNS45ODg0IiByZXN1bHQ9ImIiLz48L2ZpbHRlcj48ZmlsdGVyIGlkPSJmNCIgeD0iLTUyLjU2OTciIHk9Ii0yMC44MzQ2IiB3aWR0aD0iMTI3LjU4MiIgaGVpZ2h0PSIxMjcuNDUyIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTUuOTg4NCIgcmVzdWx0PSJiIi8+PC9maWx0ZXI+PGZpbHRlciBpZD0iZjUiIHg9IjE3LjM2MTkiIHk9IjQ1LjQ2NDYiIHdpZHRoPSIxMTYuNzg2IiBoZWlnaHQ9IjExOC43MTUiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIxNS4xOTM3IiByZXN1bHQ9ImIiLz48L2ZpbHRlcj48ZmlsdGVyIGlkPSJmNiIgeD0iLTcuNDQ3NjUiIHk9Ii02MC40NzM3IiB3aWR0aD0iMTI1LjMwMyIgaGVpZ2h0PSIxMjIuODU4IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTMuNzY5OCIgcmVzdWx0PSJiIi8+PC9maWx0ZXI+PGZpbHRlciBpZD0iZjkiIHg9IjM0LjI2MDQiIHk9Ii0yOC40NTciIHdpZHRoPSIxMTYuNzAxIiBoZWlnaHQ9IjEwNC41MDYiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSI5LjI5Mzg1IiByZXN1bHQ9ImIiLz48L2ZpbHRlcj48ZmlsdGVyIGlkPSJmMTAiIHg9Ii0xNS4xNTIyIiB5PSItMTUuOTQ5MyIgd2lkdGg9Ijc3LjI5NDEiIGhlaWdodD0iOTEuMDc2IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTEuNTAyNyIgcmVzdWx0PSJiIi8+PC9maWx0ZXI+PC9kZWZzPjwvc3ZnPgo=";
// Stands in for "some other plugin's mark", so the fallback row is not read as one vendor
// borrowing another's logo.
const PLUGIN_FALLBACK_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjE2IiBmaWxsPSIjMkEyRjNBIi8+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iMjYiIHN0cm9rZT0iIzhCOTNBNSIgc3Ryb2tlLXdpZHRoPSI4Ii8+PC9zdmc+";
const GEMINI_CLI_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIj4KICA8cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjE2IiBmaWxsPSIjZmZmIi8+CiAgPHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iODAiIGhlaWdodD0iODAiIHJ4PSIxMiIgZmlsbD0iIzFCMUUyQiIvPgogIDxwYXRoIGQ9Ik0yOCAzOCBMNDIgNTAgTDI4IDYyIiBzdHJva2U9IiM3QjhDRjUiIHN0cm9rZS13aWR0aD0iNyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgPHBhdGggZD0iTTUwIDY0IEg3MCIgc3Ryb2tlPSIjN0I4Q0Y1IiBzdHJva2Utd2lkdGg9IjciIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxwYXRoIGQ9Ik02NyAyNCBDNjcgMzEgNzEgMzUgNzggMzUgQzcxIDM1IDY3IDM5IDY3IDQ2IEM2NyAzOSA2MyAzNSA1NiAzNSBDNjMgMzUgNjcgMzEgNjcgMjQgWiIgZmlsbD0iIzRFOERGNSIvPgo8L3N2Zz4K";

const PROVIDERS: ProviderRow[] = [
  { id: "antigravity", label: "Antigravity", accountPool: "antigravity", sharedWith: ["gemini-cli"], pluginName: "antigravity-auth", authKind: "oauth", accountCount: 3, enabled: true, exposure: { alpha: true, beta: false }, translator: "gemini", icon: ANTIGRAVITY_ICON },
  { id: "gemini-cli", label: "Gemini CLI", accountPool: "antigravity", sharedWith: ["antigravity"], pluginName: "antigravity-auth", authKind: "oauth", accountCount: 3, enabled: true, exposure: { alpha: true, beta: false }, translator: "gemini", icon: GEMINI_CLI_ICON },
  // No mark of its own: falls back to the mark of the plugin that deploys it.
  { id: "claude-code", label: "Claude Code", accountPool: "claude-code", sharedWith: [], pluginName: "claude-code-auth", authKind: "oauth", accountCount: 0, enabled: true, exposure: { alpha: false, beta: false }, icon: PLUGIN_FALLBACK_ICON },
  { id: "stub", label: "Stub", accountPool: "stub", sharedWith: [], pluginName: "stub-auth", authKind: "api-key", accountCount: 0, enabled: false, exposure: { alpha: false, beta: false } },
  // Falls back to its raw id because its plugin bundle never loaded, the state the
  // Providers and Accounts screens both have to say out loud.
  { id: "half-built", label: "half-built", accountPool: "half-built", sharedWith: [], pluginName: "half-built-auth", authKind: "api-key", accountCount: 0, enabled: false, exposure: { alpha: false, beta: false }, defsError: "Cannot find package '@intisy-ai/basekit/auth' imported from dist/handler.js" },
];

const ACCOUNTS: AccountView[] = [
  { id: "acc1", email: "ben@birich.de", status: "active", enabled: true, detail: "oauth", quota: QUOTA },
  { id: "acc2", email: "spare@example.com", status: "rate-limited", enabled: true, detail: "oauth", quota: QUOTA.slice(1, 2) },
];

// Exported so the overlay specimens can render a dialog against the same data the
// Activity screen uses, rather than inventing a second version of it.
export const ACTIVITY: ActivityRecord[] = [
  {
    id: "act-1", ts: Date.parse("2026-08-10T11:59:00Z"), home: "/home/alpha", topic: "plugin.install",
    action: "plugin_installed", actor: "user", impact: "notice", source: "plugin-updater",
    subject: { kind: "plugin", id: "antigravity-auth", label: "antigravity-auth" },
    details: { url: "https://example/antigravity-auth", message: "Installed antigravity-auth into Alpha" },
    text: "Installed antigravity-auth into Alpha",
    origin: { app: "alpha", home: "/home/alpha", entry: "cairn" },
    cause: { kind: "user", surface: "plugins" }, trace: { id: "trace-1" }, outcome: "ok", durationMs: 8400,
  },
  {
    id: "act-2", ts: Date.parse("2026-08-10T11:58:00Z"), home: "/home/alpha", topic: "provider.state",
    action: "provider_enabled", actor: "user", impact: "info", source: "cairn",
    subject: { kind: "provider", id: "antigravity", label: "Antigravity" },
    details: { message: "Enabled antigravity everywhere" },
    text: "Enabled antigravity everywhere",
    origin: { app: "alpha", home: "/home/alpha", entry: "cairn" },
    cause: { kind: "user", surface: "providers" }, trace: { id: "trace-2" },
    changes: [{ key: "exposure.alpha", from: false, to: true }, { key: "apiKey", redacted: true }],
  },
  {
    id: "act-3", ts: Date.parse("2026-08-10T11:40:00Z"), home: "/home/beta", topic: "plugin.build",
    action: "plugin_repair_failed", actor: "system", impact: "error", source: "plugin-updater",
    subject: { kind: "plugin", id: "custom-auth", label: "custom-auth" },
    details: { missing: "core-auth/dist", message: "Repair left core-auth/dist missing" },
    text: "Repair left core-auth/dist missing",
    origin: { app: "beta", home: "/home/beta", entry: "updater" },
    cause: { kind: "user", surface: "plugins" }, trace: { id: "trace-3" }, outcome: "failed", durationMs: 66000,
  },
];

// One plugin-contributed settings section plus the declaration behind it, so the Settings
// screen shows the generic contribution path rather than an empty frame.
const CONTRIBUTED_SECTION = { plugin: "a-plugin", id: "feature", label: "Feature", description: "What this plugin adds to the app.", order: 40, homes: ["alpha", "beta"] };

const CONTRIBUTED_SCHEMA: PluginConfigSchema = {
  plugin: "a-plugin",
  defaults: { on: true, mirror: false, spare: true },
  current: {},
  fields: [
    { key: "on", type: "boolean", label: "Enabled", description: "Master switch for the feature." },
    { key: "mirror", type: "boolean", label: "Mirror across apps", description: "Keep both apps in step." },
    { key: "spare", type: "boolean", label: "Spare setting" },
  ],
  actions: [{ id: "run", label: "Run now", description: "Do the thing immediately." }],
  layout: {
    sections: [{
      id: "feature",
      label: "Feature",
      plugin: "a-plugin",
      fields: [
        { key: "on", type: "boolean", label: "Enabled", description: "Master switch for the feature." },
        { key: "mirror", type: "boolean", label: "Mirror across apps", description: "Keep both apps in step." },
      ],
      actions: [{ id: "run", label: "Run now", description: "Do the thing immediately." }],
    }],
    fields: [{ key: "spare", type: "boolean", label: "Spare setting" }],
    actions: [],
  },
};

// Past twenty rows the list windows itself at a fixed row height, so the fixture has to cross
// that threshold: a row whose content outgrew its height used to overlap the row beneath it.
const MANY_USERS = [
  "antigravity-auth", "claude-code-auth", "claude-code-loader", "config-ledger", "custom-auth",
  "metric-dashboard", "opencode-loader", "plugin-updater", "stub-auth", "sync-bridge", "wakatime-sync",
];

const MANY_LIBRARIES = [
  { specifier: "@intisy-ai/basekit", version: "2.1.0", usedBy: MANY_USERS },
  { specifier: "@intisy-ai/half-used", version: "0.1.1", usedBy: [] },
  { specifier: "@intisy-ai/left-behind", version: "0.9.0", usedBy: [] },
  ...Array.from({ length: 20 }, (_, index) => ({
    specifier: `@intisy-ai/library-${String(index + 1).padStart(2, "0")}`,
    version: "1.0.0",
    usedBy: ["antigravity-auth"],
  })),
];

// The plugin the "Plugin detail" overlay specimen opens, so the dialog no screenshot
// covers today renders with real-looking data rather than an empty shell.
export const PLUGIN_DETAIL: UnifiedPlugin = {
  name: "wakatime-sync",
  kind: "plugin",
  description: "Reports coding activity to WakaTime.",
  url: "https://github.com/forebay/wakatime-sync",
  updateAvailable: true,
  homes: { alpha: { installed: true, version: "1.4.0" }, beta: { installed: true, version: "1.3.0" } },
  topics: ["plugin", "metrics"],
  displayName: "wakatime-sync",
  icon: "",
  external: false,
  favorite: false,
  deprecated: false,
};
export const PLUGIN_DETAIL_HOMES = [
  { id: "alpha", label: "Alpha", managesPlugins: true },
  { id: "beta", label: "Beta", managesPlugins: true },
];

// Enough of the API for the real screens to render populated in the gallery.
export function screenFixtures(): Partial<CairnAPI> {
  return {
    activityRead: async () => ({ ok: true, data: { records: ACTIVITY, nextCursor: undefined } }),
    marketplaceSourcesList: async () => ({
      ok: true,
      data: [
        { id: "forebay", label: "forebay", type: "github-org" as const, org: "forebay" },
        { id: "demo", label: "Demo", type: "local" as const, path: "/home/me/marketplace-demo" },
        { id: "acme", label: "Acme", type: "manifest" as const, url: "https://acme.example/marketplace.json", enabled: false },
      ],
    }),
    marketplaceSourcesSave: async (sources) => ({ ok: true, data: sources }),
    enginesList: async () => ({ ok: true, data: [] }),
    librariesList: async () => ({ ok: true, data: [
      { home: HOME_ALPHA, shared: MANY_LIBRARIES, plugins: [{ plugin: "antigravity-auth", dependencies: [{ specifier: "@openauthjs/openauth", version: "0.4.3", usedBy: ["antigravity-auth"] }] }] },
      { home: HOME_BETA, shared: [
        { specifier: "@intisy-ai/basekit", version: "2.0.4", usedBy: ["claude-code-auth"] },
        { specifier: "@intisy-ai/half-used", version: "0.1.1", usedBy: ["claude-code-auth"] },
      ], plugins: [] },
    ] }),
    appsList: async () => ({ ok: true, data: HOST_APPS }),
    appsConnection: async (app: string) => ({
      ok: true,
      data: { app, cliPresent: app === "alpha", loaderId: `${app}-loader`, loaderUrl: null, loaderInstalled: app === "alpha" },
    }),
    providersList: async () => ({ ok: true, data: PROVIDERS }),
    accountsList: async (id: string) => ({ ok: true, data: id === "antigravity" ? ACCOUNTS : [] }),
    pluginsList: async () => ({ ok: true, data: SECTIONS }),
    pluginsListCached: async () => ({ ok: true, data: SECTIONS }),
    pluginLedger: async () => ({ ok: true, data: [] }),
    catalogList: async () => ({ ok: true, data: { entries: CATALOG, source: "anonymous", org: "forebay", rateLimited: false, sources: CATALOG_SOURCES, contributions: CONTRIBUTIONS } }),
    // The Settings screen applies the stored theme on mount; without this it would answer
    // "system" and repaint the gallery in whatever the host prefers, ruining the light shot.
    getConfig: async (name: string, key: string) => ({
      ok: true,
      data: name === "cairn" && key === "theme" ? document.documentElement.dataset.theme ?? "system" : undefined,
    }),
    settingsSections: async () => ({ ok: true, data: [CONTRIBUTED_SECTION] }),
    configSchemas: async () => ({ ok: true, data: [CONTRIBUTED_SCHEMA] }),
    pluginVersions: async () => ({
      ok: true,
      data: {
        alpha: { kind: "git", label: "v1.4.0", updateState: "behind", autoUpdate: true, onExperimental: false, experimentalAvailable: true },
        beta: { kind: "git", label: "v1.3.0", updateState: "current", autoUpdate: false, onExperimental: false, experimentalAvailable: true },
      },
    }),
    globalSettingsRead: async () => ({
      ok: true,
      data: {
        defaults: { logConsole: false, activityMinImpact: "info", activityMaxDays: 30 },
        current: {},
        fields: [
          { key: "logConsole", type: "boolean", label: "Mirror logs to the console" },
          { key: "activityMinImpact", type: "select", label: "Record activity from", options: [{ value: "info", label: "info" }, { value: "error", label: "error" }] },
          { key: "activityMaxDays", type: "number", label: "Keep at most (days)", min: 0 },
        ],
      },
    }),
  };
}

