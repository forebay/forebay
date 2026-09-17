import type { HomePlugins, CatalogEntry, PluginHome, UnifiedPlugin, CatalogKind } from "@forebay/shared";
import { classifyRepoName } from "@forebay/shared";

function kindOf(name: string, catalog: CatalogEntry[]): CatalogKind {
  const hit = catalog.find((e) => e.name === name);
  if (hit) return hit.kind;
  return classifyRepoName(name) ?? "plugin";
}

// Which homes a plugin can go in, most specific answer first.
//
// A loader connects exactly one app: the one whose registry entry names it. Offering it to any
// other home promises an install that could never work there. That answer comes first, so a
// loader is still offered to its own app while it is the thing not yet installed.
//
// An app whose loader is absent loads nothing the ecosystem installs, so it is not a target for
// anything else either. Forebay's own home has no loader and is unaffected.
//
// Any other plugin may declare the apps it suits, and that declaration is honoured as given:
// an app-specific plugin offered everywhere is how one app's plugins ended up installed in
// another. Declaring nothing means suiting any app, which is what most do, so the generic rule
// by kind is what remains.
export function applicableHomeIds(kind: CatalogKind, homes: PluginHome[], pluginName?: string, apps?: string[]): string[] {
  const ownApp = pluginName ? homes.find((h) => h.loaderId === pluginName) : undefined;
  if (ownApp) return [ownApp.id];
  const generic = homes
    .filter((h) => (h.id === "forebay" ? kind !== "plugin" && kind !== "loader" : kind !== "proxy"))
    .filter((h) => !h.loaderId || h.loaderInstalled !== false)
    .map((h) => h.id);
  if (!apps || apps.length === 0) return generic;
  return generic.filter((id) => apps.includes(id));
}

// GitHub owner of a repo URL (or owner/repo shorthand); null if it isn't one.
export function repoOwner(url: string): string | null {
  const cleaned = url.trim().replace(/\.git$/, "");
  const full = cleaned.match(/github\.com[/:]([^/]+)\//);
  if (full) return full[1];
  const short = cleaned.match(/^([^/\s]+)\/[^/\s]+$/);
  return short ? short[1] : null;
}

export function buildUnifiedPlugins(
  sections: HomePlugins[],
  catalog: CatalogEntry[],
  homes: PluginHome[],
  engines: { name: string; url: string }[] = [],
  marketplaceOrg = "",
  favorites: string[] = [],
): UnifiedPlugin[] {
  const engineUrls = new Map(engines.map((e) => [e.name, e.url]));
  const names = new Set<string>();
  for (const s of sections) for (const r of s.rows) names.add(r.name);
  for (const e of catalog) names.add(e.name);
  // Engines are always offered even when the catalog (org scan) omits them: an engine may live in a
  // repo the catalog filters out, and a home that already runs one must still see it.
  for (const e of engines) names.add(e.name);

  const out: UnifiedPlugin[] = [];
  for (const name of names) {
    const kind = kindOf(name, catalog);
    const catEntry = catalog.find((e) => e.name === name);
    const engineUrl = engineUrls.get(name);
    // Engines are Forebay-installable into every home (bootstrap) and carry their
    // clone URL from the engine registry when the catalog has none.
    const homeIds = engineUrl !== undefined ? homes.map((h) => h.id) : applicableHomeIds(kind, homes, name, catEntry?.apps);
    const rows = sections.flatMap((s) => s.rows.filter((r) => r.name === name).map((r) => ({ home: s.home.id, r })));
    const installedPluginId = rows.map((x) => x.r.pluginId).find((id): id is string => !!id && id.length > 0);
    const installedDesc = rows.map((x) => x.r.description).find((d) => d && d.length > 0) ?? "";
    const installedName = rows.map((x) => x.r.displayName).find((d) => d && d.length > 0);
    const installedIcon = rows.map((x) => x.r.icon).find((i) => i && i.length > 0);
    const installedUrl = rows.map((x) => x.r.url).find((u) => u && u.length > 0);
    const url = catEntry?.url ?? engineUrl ?? installedUrl;
    // Catalog and engine repos are the trusted org; a plugin is external only when
    // its own repo owner differs from the configured marketplace org.
    const owner = url ? repoOwner(url) : null;
    const external = !!marketplaceOrg && !!owner && owner !== marketplaceOrg;
    const homesMap: UnifiedPlugin["homes"] = {};
    for (const id of homeIds) {
      // A row that names the plugin without it being present is an install that has not
      // happened yet, and calling it installed offers a remove for something that is not there.
      const hit = rows.find((x) => x.home === id && x.r.present !== false);
      homesMap[id] = { installed: !!hit, version: hit?.r.installedVersion };
    }
    out.push({
      name,
      pluginId: installedPluginId,
      kind,
      description: installedDesc || (catEntry?.description ?? ""),
      url,
      updateAvailable: rows.some((x) => x.r.updateAvailable),
      homes: homesMap,
      topics: catEntry?.topics ?? [],
      displayName: installedName || catEntry?.displayName || name,
      icon: installedIcon || catEntry?.icon || "",
      external,
      apps: catEntry?.apps,
      favorite: favorites.includes(name),
      deprecated: catEntry?.deprecated ?? false,
      sourceId: catEntry?.sourceId,
    });
  }
  out.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  return out;
}
