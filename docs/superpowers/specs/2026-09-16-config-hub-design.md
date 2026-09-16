# Config hub for Appearance and Behavior

**Date:** 2026-09-16
**Status:** Design approved, not implemented. Branch `config-redesign`.
**Mockups:** `.superpowers/brainstorm/20278-1789591952/content/` (local only) —
`appearance-structure.html` (option C) and `group-page.html`.

## What this is for

Appearance has seven tabs and Behavior six, each a stack of panels with every
setting at the same weight. A reader who has just installed nextDash has to
read all of them to find the three that change how the dashboard looks, and
nothing on screen shows what a setting does before it is changed.

Both sections become a hub: a start screen of tiles that say what is set, and
behind each tile a group page that leads with the few choices that matter,
drawn, and keeps the rest one click away. Appearance shows a live miniature of
the dashboard beside the choices; Behavior explains each group with an
illustration instead.

The main audience is a new reader (set the dashboard up in a minute); a
returning reader looking for one setting is served by the tiles' summaries and
by the search that already exists.

## Decisions

| Question | Decision |
|---|---|
| Audience | Both, with the weight on new readers. |
| First impression | Basics as visual cards on top, "More settings" below, plus a live preview. |
| Structure | A start screen of tiles; a click opens the group. |
| Behavior | Same hub, no live preview; an illustration with a short explanation per group. |
| Approach | A new description layer on top of the existing schema; no schema rewrite, no new settings. |

## The tiles

### Appearance — seven tabs become six tiles

| Tile | Holds (today's tabs) | Summary on the tile |
|---|---|---|
| Theme | Theme | theme name, light/dark, depth |
| Grid | Layout + Display | columns · density · text size |
| Header & buttons | Header and buttons + Action bar | switcher style · where the buttons stand |
| Date & weather | Date & weather | location · 24h/12h |
| Custom themes | Custom themes | "2 made" or "Make your first" |
| Advanced | whatever no group's basics cover | "12 settings" |

### Behavior — six tabs, six tiles

General, Search, Inbox, Fresh, Status & health, Privacy. Each tile shows the
two or three choices that say most about the group, e.g. "Finders included ·
opens at once".

### How a tile behaves

- Icon, title, a live summary read from the settings, and a mark when anything
  in the group differs from its default.
- A click opens the group page. Back, or Escape, returns to the start screen.
- The start screen is `#config/appearance` (`#config/behavior`); a group is
  `#config/appearance/<group>`. Old tab links (`layout`, `display`,
  `buttonbar`, `header`, `datetime`, `general`, `custom-themes`, and Behavior's
  tab ids) open the group that now holds them.
- "Only changed" and the settings search stay at the top of the section and
  search across every group, labelling each hit with its group.

## The group page

- Heading: a breadcrumb "← Appearance / Header & buttons" and a one-sentence
  explanation.
- Basics: two to four cards with the choices that change most. Each option is
  drawn with the existing `static/js/shared/setting-art.js` where a drawing
  exists, as a labelled option otherwise. The ⓘ and ↺ affordances stay on each
  card.
- More settings: collapsed, rendered by the existing `renderControlPanels`
  with the basics filtered out. Whether it is open is remembered per group in
  `localStorage`.
- Right column:
  - Appearance: a live miniature of the dashboard (header, grid, dock) that
    changes as a choice is made.
  - Behavior: an illustration with a short explanation per group (for Search,
    the search panel with "gh" typed).
- Below 900px the right column moves under the basics.

Which fields are basics is declared per group in `config-hub.js`; every other
field of the group's tabs falls into More settings automatically.

## Components

- `static/js/dashboard/config-hub.js` (new, lazy-loaded with the config
  module): one description per section. Per tile: `id`, icon, title, the
  existing tab ids it holds, `summary(settings)`, and `basics` (fields plus the
  drawing per option). It renders the start screen and the group page's basics;
  it does not save anything.
- `static/js/shared/config-preview.js` (new): the Appearance miniature. Reads
  the settings and the body's `data-*` attributes and redraws on every change
  through the existing `special: 'chrome'` path.
- `static/css/config-hub.css` (new): tiles, cards, preview, illustrations, the
  900px breakpoint. No `backdrop-filter` on anything clickable.
- `static/js/dashboard/dashboard-config.js`: thin wiring only — the Appearance
  and Behavior renders choose start screen or group; the hash handling maps old
  tab ids to groups; More settings reuses `renderControlPanels` with the basics
  removed. No reorganisation of the file.

Saving, resets, info modals and the settings search keep going through the
code that does them today. No new settings, no server changes. New strings go
into `locales/en.json` only, with `t()` fallbacks.

## Edge cases

- A basics field no longer in the schema is skipped and logged to the console.
- "Only changed" on the start screen lists changed fields across all groups,
  each labelled with its group; inside a group it filters that group.
- An unknown group in the hash opens the start screen.
- Reset panel on a group resets its basics and its More settings.
- The Custom themes tile opens the existing theme editor unchanged.

## Testing

Behaviour only, no pixel assertions. Only the specs that cover the change,
`PW_WORKERS=2`, never port 8080.

- The start screen shows every tile, and a tile's summary changes after the
  setting it names is changed in its group.
- A tile opens its group; Back and Escape return; each old tab link opens the
  group that holds it.
- Choosing a basics card saves the setting and changes the preview (asserted
  through the preview's attributes, not its drawing).
- More settings holds the group's other fields and remembers being open.
- Search finds a field that lives in another group, and opening the hit lands
  in that group.
- Existing config specs that open a tab get the new route; their behaviour
  assertions stay.

## Build order

1. Appearance: tiles, groups, basics, preview.
2. Behavior: tiles, groups, basics, illustrations.
3. Remove what the hub replaced (the tab strips for these two sections) and
   check the result by hand on a glass, a rich and a flat theme.

## Out of scope

- Other config sections.
- New settings, or moving settings between the two sections.
- Translations beyond English (docs round).
