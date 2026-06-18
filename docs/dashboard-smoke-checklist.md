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

## Toolbar & modals

- [ ] Search `>`, commands `:`, finders `?` open and close
- [ ] Recent `*`, cheat sheet `!` / `F1`
- [ ] `Shift+M` move popover: focus in popover, `↑`/`↓`, `Enter`, `Escape`
- [ ] `Shift+T` tag popover: focus in `#tag-popover`, `↑`/`↓`, `Enter`/`Space` toggles and advances, dashboard `inert`
- [ ] `Shift+D` delete popover: same keyboard flow

## Side rail (if enabled)

- [ ] Rail buttons and right-side tooltips work
- [ ] Tag cloud opens beside rail
