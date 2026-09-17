# Forebay visual direction

What the UI is trying to look like, stated in numbers so a screen can be checked against it
instead of argued about. The scale itself lives in `src/renderer/app.css`; this file says how to
use it.

## Seeing the UI before shipping it

`npm run gallery` opens a dev-only page rendering every component in every state against fixture
data (real components, real `app.css`, stubbed `window.forebay`, no sidecar). `npm run gallery:shots`
builds it and writes one image per section, theme and width to `out/gallery-shots/`, which is how
a change gets looked at rather than imagined. The `screens` section renders the real Plugins and
Apps routes against fixtures, so a layout change can be judged on the actual screen.

## Density

Forebay is an operator console: many rows on screen beats generous whitespace.

- **Row**: `12px` vertical, `18px` horizontal padding, `14px` between cells. A row with one line
  of title plus a subtitle lands at roughly 62-66px, which is the number `ROW_HEIGHT` and the
  virtualizer are tuned to.
- **Card**: `12px` padding all round, `10px` between the parts, `240px` minimum track width
  (`--track-card`), `10px` grid gap. A card is a row folded into two lines, not a poster.
- "Compact" means the box shows an icon, a title line and one line of supporting text. Anything
  that needs a third line belongs in the detail drawer.
- Lists stay navigable as plugins, providers and loaders grow without bound: every list gets
  search, and `ItemList` windows itself past 40 rows (`virtualizeAfter` where a screen needs a
  tighter bound). Never fetch per-item detail to paint a list; use the count already on the row.
- A screen that groups its items keeps every group collapsed until asked. Accounts lists every
  provider that way: the header count comes from the provider row, and a provider's accounts are
  read on the click that opens its section.

## Light and dark

Both themes are first-class and stamped explicitly on `<html data-theme>`; nothing depends on
`prefers-color-scheme` alone. The intent is the same in both: a quiet neutral ground, one accent,
and colour reserved for state.

- `--bg` is the window ground, `--surface` is the sheet content sits on, `--surface-2` is a
  recess (hovered row, card fill, chip). Depth comes from these three plus a hairline border,
  not from shadows. Shadows (`--elev-1` popovers, `--elev-2` dialogs) mean "floating above the
  page" and nothing else.
- Text runs `--text` (primary), `--muted` (supporting prose), `--faint` (metadata and labels).
  Three levels, no more.

## Accent and state colour

- `--accent` marks exactly one thing per screen: the primary action. Selection, focus rings and
  the version chip are its weak forms (`--accent-weak`, `--accent-border`).
- `--good` / `--warn` / `--crit` are reserved for state the operator must act on. A status pill
  or a quota figure earns colour; a heading, a border or a background does not.

## Card or row

- **Row** is the default: it is denser, aligns its columns down the whole list, and has room for
  actions on the right.
- **Card** is for browsing an unfamiliar set, where the icon and the description matter more than
  the exact value in a column. Both come from the same `ItemBox`, so switching view never changes
  the density story.

## Structure

- `ItemBox` owns one item's chrome (icon, title, badges, subtitle, meta, actions, corner) in both
  views. `ItemList` owns the list/grid switch, the card grid, virtualization and the empty state.
  Plugins, Apps, Providers and Accounts all render through them. A tabular list passes `columns`
  so its cells line up down the whole list, and `openTarget="row"` when clicking anywhere in the
  row should open it. Libraries is a data table, not a list of item boxes, and stays one.
- A screen paints once. Where a cached read exists it must cover the whole row set, and the fresh
  reads that follow are applied in one batch: a list that grows and reorders as responses land
  reads as broken however fast it is.
- Sizes and colours in a component `<style>` block come from the scale. `npm run check:css`
  enforces this against a per-file baseline that may only shrink: new code is held to zero raw
  values, old drift is worked off file by file.
