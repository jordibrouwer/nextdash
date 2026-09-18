# Surface glow across the theme register

**Date:** 2026-09-11
**Status:** Implemented on branch `theme-glow`

## What this is for

A raised surface in nextDash can bleed a little of the theme's accent out
around its edge. Aurora Glass does it, Retro CRT Mk II does it, and on those
two themes a widget reads as something lit rather than something drawn. On
most of the other 220 themes nothing glows at all, and in the config view
nothing glows in the classic layout no matter which theme is picked.

The mechanism for this already exists and needs neither a new field nor a new
setting. What it needs is a derivation that does not write off half the
register, and a token that reaches further than the two places it reaches now.

## What is actually wrong today

Measured against the packaged register (222 built-in themes):

| derived glow | themes |
|---|---|
| 0 | 132 |
| 0.02 – 0.44 | 48 |
| 0.45 (the cap) | 40 |
| declared above the cap | 2 |

Two separate causes sit behind that first row, and both had to be named before
anything could be designed.

**The derivation writes off every light theme.** `themeSurfaceGlow`
(`internal/app/handlers.go`) multiplies three unit terms — accent chroma,
accent lightness, and how dark the page is. The third is
`(0.45 - pageLightness) / 0.25`, which is zero for any page lighter than 0.45.
All 109 light themes therefore land on exactly 0. So do 23 dark themes whose
accent carries too little chroma to survive the first term: nordic-frost,
sumi-ink, storm-petrel and their neighbours. Of those 23, only nocturne-ink
and porcelain actually asked for silence by declaring `-1`.

**The glow reaches two tokens, one of which is layout-bound.** It is written
into `--edge-light` and into `--layout-shadow-sm/md/lg`
(`static/css/theme-character.css`). Every single consumer of a
`--layout-shadow-*` value sits inside a `body[data-layout-version="modern"]`
rule — 58 such blocks in `config-view.css` alone — so in the classic layout
those tokens resolve to nothing and the surfaces that read them simply carry
no shadow. Classic gets glow only where `--edge-light` is painted: the card
presets, the widget body, the modal, and the theme browser's tiles.

Both causes are fixed here. Neither is fixed by touching a theme definition:
hand-writing a number for 222 themes would be inventing 222 opinions.

## Decisions, and why

**Glow stays a property of the theme.** No new setting, no new field in
`settings.json`, nothing to migrate, translate or document in six locales. It
follows the theme and the existing depth choice, exactly as it does now, and
`data-depth="flat"` keeps switching it off because a reader who asked for flat
asked for no layers.

**A light page gets a tinted shadow, not a halo.** The comment on the current
formula is right that a glow on paper is a smudge — but Aurora Glass [light]
declares 0.6 and looks composed, because there the accent is a colour *under*
the surface rather than light *around* it. That is the distinction the light
branch encodes: same strength scale, different geometry.

**No theme is flat by accident.** A floor means a silent palette still says
something. A theme that genuinely wants nothing says so with `-1`, and that
stays absolute.

**The glow rides the existing shadow rather than replacing it.** Adding a
`box-shadow` rule to a selector that already has one replaces the shadow
instead of adding to it — `box-shadow` stacks within a declaration, not across
declarations. This was already got wrong once and the fix was to move the glow
into the tokens; that stands.

**Classic gets glow, not shadows.** The classic layout never had raised
surfaces and is not getting them. Only the accent layer is added there, so
classic stays flat-with-colour rather than becoming a second modern.

## The design

### 1. Derivation (`themeSurfaceGlow`, `internal/app/handlers.go`)

Two branches, chosen on `pageLightness` from `hexOklch(tc.BackgroundPrimary)`.

*Dark page* — the present formula, rebounded:

```
chroma  = unitRange((accentChroma    - 0.08) / 0.12)
light   = unitRange((accentLightness - 0.45) / 0.30)
ground  = unitRange((0.45 - pageLightness) / 0.25)
glow    = clamp(chroma * light * ground * 0.99, floor 0.15, cap 0.60)
```

*Light page* — the ground term inverts. A dark saturated accent tints a shadow
well; a pale one does not:

```
chroma  = unitRange((accentChroma - 0.06) / 0.12)
depth   = unitRange((0.62 - accentLightness) / 0.30)
glow    = clamp(chroma * depth * 0.70, floor 0.12, cap 0.35)
```

The light cap sits deliberately below the dark one. On paper this is a tinted
shadow and it should be felt, not seen.

Unchanged: a declared `SurfaceGlow > 0` wins and may reach 1.0; a declared
`-1` returns `0` before either branch runs; the function stays pure and
deterministic.

The exact multipliers are the starting point, not the contract. They get one
visual pass across a spread of themes (a neon dark, a muted dark, a pastel
light, a paper light) and are tuned there.

### 2. A second token, so CSS need not re-derive the page

`renderThemeCSSBlock` writes one line beside the existing
`--theme-surface-glow`:

```
--theme-glow-lift: 1 | 0;
```

1 is a halo, 0 a tinted shadow, chosen by the same `pageLightness` test. A
number rather than a word from a fixed list, which is what this was during
design: CSS cannot branch on what a variable *says*, so a word would have had
nothing to match it against, while a number the four lengths interpolate with
needs no matching at all.

### 3. The token layer (`static/css/theme-character.css`)

One fragment token that *is* a shadow layer:

```css
--glow-y: calc(6px + 4px * var(--theme-glow-lift, 1));
--glow-blur: calc(18px + 8px * var(--theme-glow-lift, 1));
--glow-spread: calc(-6px - 6px * var(--theme-glow-lift, 1));
--glow-pct: calc(34% + 16% * var(--theme-glow-lift, 1));

--surface-glow-ring:
    0 var(--glow-y) var(--glow-blur) var(--glow-spread)
    color-mix(in srgb, var(--accent-primary)
        calc(var(--theme-surface-glow, 0) * var(--glow-pct)), transparent);
```

The lift slides each length between the two ends:

| lift | `--glow-y` | `--glow-blur` | `--glow-spread` | `--glow-pct` |
|---|---|---|---|---|
| 1, halo (dark page) | 10px | 26px | -12px | 50% |
| 0, shadow (light page) | 6px | 18px | -6px | 34% |

Strength is spent on the colour alone and not on the lengths. Scaling the
geometry too was tried first and does not work: at the new floor of 0.12 a 6px
shadow becomes 0.7px, so the themes this layer exists for got a glow that
cannot be seen.

`--edge-light` and `--layout-shadow-sm/md/lg` then append
`var(--surface-glow-ring)` as their second layer, which replaces the four
hand-written `calc()` chains now in that file — net less CSS than today.

At glow `0` the colour is fully transparent, so a `-1` theme paints nothing and
renders as it does today. That property is what makes the whole change safe to
land in one commit.

### 4. Where it lands

Already covered by the token layer, with no new rule:

- classic: `.dashboard-grid.layout-cards .category`,
  `.dashboard-grid.layout-widgets .category`,
  `.dashboard-widget .dashboard-widget-body`, `.modal`, theme-browser tiles —
  all paint `--edge-light` already (`static/css/theme-depth.css`)
- modern: config tiles and panels, health items, inbox rows, feed rows, the
  list-view shell, multi-select, quickstart — all read `--layout-shadow-*`

New, and only for the classic layout — a glow-only rule, no grey base shadow:

```
.config-tile, .config-panel, .config-choices, .search-container,
.lvs-summary, .lvs-group, .quickstart-card, .health-monitor-stat
```

Deliberately excluded: `.feed-row`, `.inbox-item`, `.health-view-item`,
`.config-crud-row`. Fifty glowing rows in a column is noise, not depth, and in
classic those rows have no surface to lift. In modern they keep the glow they
already have.

### 5. Preferences and edge cases

- `prefers-contrast: more` sets `--theme-surface-glow: 0`. That block already
  zeroes the tint and halves the depth on the same argument: a reader asking
  for contrast is asking for the flat version, and an accent-coloured halo is
  exactly the kind of colour movement that costs it.
- `prefers-reduced-transparency` does **not** touch the glow. That preference
  is about seeing through things; glass already falls back to rich and the
  shadow may stay.
- `data-depth="flat"` keeps excluding it. Unchanged.
- Reduced motion does not apply — the glow is static. The pulsing glow on the
  new-features panel is a different thing and is not touched.
- paper-ink, bone-china and salt-flat get `SurfaceGlow: -1` on their register
  entries. They already have a hand-written block damping tint and depth;
  without the explicit `-1` the light branch would hand them a tinted shadow,
  and paper should stay paper.
- Custom themes need nothing. `surfaceGlow` is in `ThemeColors` but no UI
  writes it, so a user's own theme runs through the new derivation like any
  other. No migration, no settings version bump.

Cost: one extra `box-shadow` layer on surfaces that already have one, plus
about eight selectors in classic. No pseudo-elements, no filters, no layout
work.

## Testing

**Go** — `TestDerivedGlowFollowsThePalette`
(`internal/app/theme_character_test.go`) currently asserts `paper != 0` is a
failure and `neon > 0.45` is a failure. Both invert. Added alongside:

- no built-in theme derives to `0` unless it declares `-1`, checked against a
  named list of the themes that do (nocturne-ink, porcelain, paper-ink,
  bone-china, salt-flat) rather than a count
- for the same accent, the light branch stays below the dark branch
- `--theme-glow-lift` is `1` or `0` and never anything else, and matches the
  page lightness of every built-in theme

**Playwright** — one new spec, `tests/theme-glow.spec.js`, driving the real
entry point: pick the theme in Config → Appearance rather than setting
`data-theme` by hand. It checks the computed `box-shadow` on `.config-panel`
in both layouts for a light theme, a dark theme and a `-1` theme, and that
`prefers-contrast: more` removes the glow. The existing `config-theme-*` specs
run alongside it, since they touch the same stylesheet.

**Falsification** — the glow-mode branch and the classic selector list are
behaviour changes and each gets a deliberate break to prove the test catches
it. The token refactor in `theme-character.css` is cleanup and does not.

## Documentation

A changelog line lands with the change. The changelog entry and the What's New
modal wait for a settled version number; `MANUAL.md` may be updated now
without a version tag. Help, tips, Overview and About follow in a docs round.

## Not in scope

- A reader-facing glow control. Considered and rejected: a new settings field,
  a migration, six locales and four documentation surfaces, for a choice the
  theme already expresses.
- Giving the classic layout the modern layout's base shadows. That is a much
  larger visual change than this asks for, and it would mean unpicking dozens
  of modern-scoped blocks.
- A `.nd-*` class layer to replace the hand-maintained selector lists. Worth
  doing, and it would collapse both the glass list and the glow list into one
  name — but it is its own project.
