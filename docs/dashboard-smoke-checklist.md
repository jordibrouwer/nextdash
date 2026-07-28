# Dashboard smoke checklist (~5 min)

Run after every dashboard refactor PR. No behavior change expected unless noted.

## Bootstrap & pages

- [ ] Cold start: dashboard loads bookmarks and categories
- [ ] Switch page: number keys `1`–`9`, `Shift+←/→`, page tab click
- [ ] URL hash updates when switching pages
- [ ] Empty page shows empty state (if available)

## Bookmarks & reorder

- [ ] Arrow-key grid navigation selects a bookmark
- [ ] Drag reorder bookmark + `Escape` undo
- [ ] Open bookmark (Enter / click)

## Inline edit

- [ ] `;` opens inline edit on selected row
- [ ] Cancel restores row; unsaved page switch shows confirm

## Tag filter

- [ ] `/` tag cloud → apply filter on dashboard
- [ ] Bulk move / bulk delete (if matches exist)
- [ ] `Escape` clears filter

## Config sync

- [ ] Change bookmark in Config → return to dashboard without full reload
- [ ] Settings change (e.g. theme) applies on dashboard return

## Config lazy load

The view is fetched on first open, so these are the paths a stale stub breaks.

- [ ] `<` / `Shift+S` opens config on a page that has not opened it yet
- [ ] Deep link `#config/behavior/privacy` from a cold load lands on Privacy
- [ ] `Escape` closes config and returns to the grid
- [ ] Console clean on a plain dashboard load (no font-preload or CSP warning)

## Toolbar & modals

- [ ] Search `>`, commands `:`, finders `?` open and close
- [ ] Recent `*`, cheat sheet `!` / `F1`
- [ ] `Shift+M` move popover: focus in popover, `↑`/`↓`, `Enter`, `Escape`
- [ ] `Shift+T` tag popover: focus in `#tag-popover`, `↑`/`↓`, `Enter`/`Space` toggles and advances, dashboard `inert`
- [ ] `Shift+D` delete popover: same keyboard flow

## Side rail (if enabled)

- [ ] Rail buttons and right-side tooltips work
- [ ] Tag cloud opens beside rail
