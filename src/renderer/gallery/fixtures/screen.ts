import type { PluginScreen } from "@forebay/shared";

export const GALLERY_SCREEN: PluginScreen = {
  plugin: "demo", id: "demo", label: "Demo", glyph: "◆", order: 10, homes: ["claude", "opencode"],
  layout: {
    kind: "stack",
    children: [
      { kind: "stats", source: "summary" },
      { kind: "banner", source: "notice", tone: "warn" },
      {
        kind: "tabs",
        tabs: [
          { id: "data", label: "Data", child: {
            kind: "grid", columns: 2, children: [
              { kind: "card", title: "Rows", children: [
                { kind: "table", source: "rows", groupBy: "file", columns: [{ key: "key", tone: "mono" }, { key: "old", tone: "old" }, { key: "new", tone: "new" }] },
              ] },
              { kind: "card", title: "Items", children: [
                { kind: "list", source: "items", rowActions: ["open"], item: { title: "subject", subtitle: "date", badge: "short" } },
                { kind: "meter", source: "quota" },
              ] },
            ],
          } },
          { id: "controls", label: "Controls", child: {
            kind: "card", title: "Controls", children: [
              { kind: "chips", source: "chips", select: "select" },
              { kind: "form", submit: "save", fields: [{ key: "note", type: "string", label: "Note", placeholder: "Optional" }] },
              { kind: "actions", ids: ["refresh", "wipe"] },
              { kind: "text", text: "Everything above is declared by the plugin." },
            ],
          } },
        ],
      },
    ],
  },
};

export const GALLERY_SOURCES: Record<string, unknown> = {
  summary: [{ id: "a", label: "Pending", value: 3 }, { id: "b", label: "Snapshots", value: 12 }, { id: "c", label: "Profile", value: "main" }],
  notice: "A refused action explains itself here.",
  rows: [
    { id: "1", file: "settings.json", key: "theme", old: "dark", new: "light" },
    { id: "2", file: "settings.json", key: "font", old: "12", new: "13" },
    { id: "3", file: "plugins.json", key: "autoUpdate", old: "false", new: "true" },
  ],
  items: [{ id: "a1b2c3d4", short: "a1b2c3d", subject: "manual snapshot", date: "2026-08-11" }],
  quota: { used: 40, total: 100 },
  chips: [{ id: "main", label: "main", current: true }, { id: "work", label: "work", current: false }],
};
