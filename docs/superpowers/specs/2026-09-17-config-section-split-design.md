# Splitting dashboard-config.js into per-section modules

**Status:** design approved 17 September 2026
**Author:** Jordi + Claude

## Why

`static/js/dashboard/dashboard-config.js` is 27,627 lines and 1.4 MB — a
quarter of all the JavaScript in the repo, 807 methods and 88 statics in one
class. Two things follow from that:

1. **It is fetched whole.** Opening config pulls 1.4 MB over the wire to draw
   one section, and every section's code sits in memory for the life of the
   tab.
2. **It has no internal boundaries.** A change in Appearance is one careless
   line away from Health, and nothing in the file says where one subject ends
   and the next begins.

An earlier attempt (2026-07-28) split the file into eight modules in one pass
and was reverted: 41 config e2e tests failed, across auto-dark, backup-restore,
bookmarks-editor, custom-themes and dashboard-view. Every mechanical check
passed — 293 methods present, none duplicated, all names resolving, every file
parsing. The damage was behavioural and invisible to those checks, because
moving a method into a collaborator object means rewriting every `this.<state>`
access, and both spellings are valid JavaScript.

This design takes the failure as its main constraint.

## Goals

- Config's first paint fetches the shell and the section being opened, not all
  eleven sections.
- Each section is one file with a name that says what is in it.
- No section's extraction can break another, and any breakage is bisectable to
  one commit.

## Non-goals

- Rewriting state ownership. Every `this.<field>` stays on the orchestrator.
  Tightening a section's state is a separate, later question.
- New abstractions. No base class, no registration DSL, no dependency
  injection. The section files are flat `Object.assign` calls, matching the two
  that already exist.
- Splitting `behaviorSchema`. See "The boundary" below.

## The shape

Each section becomes `static/js/dashboard/dashboard-config-<section>.js`, with
the same wrapper the two existing extractions use
(`dashboard-config-bookmarks.js`, `dashboard-config-stats.js`):

```js
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;
    Object.assign(global.DashboardConfig.prototype, {
        renderLogsSection() { /* moved verbatim */ },
    });
}(typeof window !== 'undefined' ? window : globalThis));
```

Because the methods land on the same prototype, `this` means what it meant
before. Moving a method is a cut and a paste, not a rewrite — which is exactly
what the 2026-07-28 attempt could not say.

Per-section statics (`HELP_PANEL_ART`, 523 lines, to Help; `WIDGET_SETTINGS`,
201 lines, to Widgets) move with their section as `DashboardConfig.X = …`
assignments in the same file.

## Loading

One new method on the orchestrator, `ensureSection(id)`, modelled on the
existing `ensureBookmarkRenderers()`:

- Keeps one promise per section id, so two clicks are one fetch.
- Loads through `window.LazyScript.loadScriptOnce(rel, datasetKey, isReady)`,
  where `isReady` tests that the section's anchor method is on the prototype.
- Fails soft: if the fetch fails, the view stays on the section it was on and
  `notify` says so. No blank body.

**Where it is awaited.** Three call sites, the same ones that already await the
bookmark renderers:

1. `openConfigView(section)` — before `loadAndRender()`.
2. The section-switch path around line 4524 (`setSection`), which already has
   the "wait, then repaint" shape for `bookmarks`.
3. The hash router, when a deep link names a section.

`renderSection()` and everything under it stay synchronous. This is the whole
reason for awaiting at navigation: `renderSection()` is called from inside a
template string (`${this.renderSection()}`), where awaiting is impossible
without rewriting the shell.

**Preloading.** After the first section has painted, the remaining sections are
fetched one at a time inside `requestIdleCallback` (with a timeout, so a busy
tab still gets there). Sequential rather than parallel: config's own data
fetches and the dashboard's must not queue behind eleven scripts.

**One list.** `DashboardConfig.SECTIONS` stays the single source of section ids
and gains the file name per section. `dashboard-config-loader.js` mirrors that
list today and `config-lazy-load.spec.js` fails when the two drift; that spec
is extended to cover the file names, so a section cannot be added with no file
or a file with no section.

## The boundary

**Stays in `dashboard-config.js`** (~8,000 lines):

| What | Why |
|---|---|
| `t`, `notify`, `writeFetch`, `confirmAction`, `guardUniqueName`, `saveSettingsWithFeedback` | Shared by every section; `t` alone has 1,411 calls |
| `renderShell`, `renderSection`, `renderTile`, section nav, hash routing, last-location memory, `ensureSection` | The shell is what a section is drawn into |
| `renderControlPanels` (225), `panelsFor`, `setBehavior` (162), `FIELD_META` (183) | The field and panel machinery every section's settings are drawn and saved with |
| `behaviorSchema` (776) | Describes the settings of every section, and is read by the settings search, the config hub and the command palette. Splitting it per section would make searching load all eleven — the opposite of the point |

**Moves with its section:** its render methods, its own bindings, its own
statics, its own helpers.

## Order of work

One section per commit, smallest and most isolated first, so the loading
machinery is proved on cheap ground before it carries Appearance:

| # | Section | Approx. lines |
|---|---|---|
| 1 | logs | 1,091 |
| 2 | help | 1,549 |
| 3 | stats | 1,039 (already partly extracted) |
| 4 | overview / news | 835 |
| 5 | behavior | 1,083 |
| 6 | pages / tags / structure | 2,118 |
| 7 | data & backups | 2,449 |
| 8 | bookmarks | 2,988 |
| 9 | widgets | 3,040 |
| 10 | appearance / themes | 3,377 |

Line counts are from a name-based census and are approximate; the plan's tasks
carry the real boundaries.

The loading machinery (`ensureSection`, the await points, the idle preload, the
SECTIONS change) ships with step 1, proved on Logs.

## Verification

Per step, in seconds:

- **A census diff.** A script compares the prototype's method names before and
  after the move: nothing gone, nothing duplicated, nothing renamed. Duplicate
  definitions are the real hazard here — a second `Object.assign` overwrites in
  silence.
- **Parse and order.** `node --check` on both files, and a check that the
  section file touches nothing before `DashboardConfig` exists.
- **One ten-second smoke spec.** Open config, walk every section, fail on the
  first console error or empty body. This is what tells "the method is there"
  apart from "the section draws" — the distinction the 2026-07-28 attempt
  missed.
- **One commit per section**, so a later failure bisects to one move.

At the end, once:

- the full config suite and the specs that lean on config;
- falsification: one deliberate break per section, to see the suite catch it;
- a measurement of what actually crosses the wire when config opens, so the
  win is on the record.

## Risks

| Risk | Mitigation |
|---|---|
| A method is moved that another section calls | It still resolves: same prototype. The census diff catches disappearance, the smoke spec catches a broken draw |
| Two files define the same method | Census diff fails the step |
| A section is opened before its file lands | `ensureSection` awaits at all three navigation points; the smoke spec walks every section |
| The preload competes with config's own fetches | Sequential, inside `requestIdleCallback` with a timeout |
| A deep link lands on a section whose file fails to load | `ensureSection` fails soft: stay put, notify, no blank body |

## What "done" looks like

- `dashboard-config.js` is around 8,000 lines: shell, schema, shared helpers.
- Ten section files, each named for its subject, each loaded on demand.
- Opening config fetches the shell plus one section.
- The full config suite is green, and each section's extraction is one commit.
