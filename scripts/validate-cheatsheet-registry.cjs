#!/usr/bin/env node
/**
 * Structural checks on the cheat sheet registry.
 *
 * The registry is plain data read by three consumers (modal, printable PDF,
 * locale parity), so a typo in a cheatKey or a `when` guard that throws only
 * surfaces when someone opens the sheet. This runs it headlessly instead.
 *
 * Usage: node scripts/validate-cheatsheet-registry.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

const sandbox = { window: {}, console };
sandbox.global = sandbox;
for (const file of [
    'static/js/shared/keyboard-view-legends.js',
    'static/js/shared/keyboard-cheat-sheet-registry.js',
]) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
}

const registry = sandbox.window.KeyboardCheatSheetRegistry;
const legends = sandbox.window.KeyboardViewLegends;
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8')).dashboard;

const errors = [];
const fail = (msg) => errors.push(msg);

if (!registry) {
    console.error('KeyboardCheatSheetRegistry did not load.');
    process.exit(1);
}

console.log('Validating cheat sheet registry…');

/**
 * Rows that have never had a locale string and render from the English
 * fallback in the code — in every language, including Dutch, German, and
 * French. This predates the registry; the registry only made it visible.
 *
 * Listing them here keeps the check green on known debt while failing on
 * anything new. Delete an entry once its string lands in all four locales.
 */
const KNOWN_UNTRANSLATED = new Set([
    'bmQuickTag',
    'cbMoveEditCopy', 'cbCategory', 'cbFilter', 'cbOpenTagCat', 'cbGotoNav',
    'sectionCommandsNavigation', 'cnPage', 'cnRecent', 'cnOverview', 'cnWhatsnew', 'cnReload', 'cnConfig',
    'caDisplayToggles', 'caDisplayMore', 'caCollections',
    'sectionCommandsTools', 'ctBackup', 'ctMetadata', 'ctMonitor', 'ctTelemetry',
]);

/* 1. Every locale key the registry can ask for exists in en. */
const { cheatsheet: csKeys, flat: flatKeys } = registry.collectLocaleKeys();
const untranslated = [];
for (const key of csKeys) {
    if (key in (en.cheatsheet || {})) continue;
    if (KNOWN_UNTRANSLATED.has(key)) { untranslated.push(key); continue; }
    fail(`missing en string: dashboard.cheatsheet.${key}`);
}
for (const key of flatKeys) {
    if (!(key in en)) fail(`missing en string: dashboard.${key}`);
}
// A key that got translated should be removed from the allow-list, or the list
// silently rots into a place where real regressions can hide.
for (const key of KNOWN_UNTRANSLATED) {
    if (key in (en.cheatsheet || {})) {
        fail(`${key} now has an en string — remove it from KNOWN_UNTRANSLATED`);
    }
}
console.log(`  ok ${csKeys.length + flatKeys.length} locale keys resolve in en`
    + (untranslated.length ? ` (${untranslated.length} known untranslated)` : ''));

/* 2. Legend-backed sections resolve their rows, and those cheatKeys exist too. */
for (const section of registry.SECTIONS) {
    if (!section.legend) continue;
    const rows = legends?.[section.legend];
    if (!rows?.length) {
        fail(`section ${section.id} references empty legend ${section.legend}`);
        continue;
    }
    for (const row of rows) {
        if (!(row.cheatKey in (en.cheatsheet || {}))) {
            fail(`missing en string for legend row: dashboard.cheatsheet.${row.cheatKey}`);
        }
    }
}
console.log('  ok legend-backed sections resolve');

/* 3. No duplicate keys+cheatKey pair inside one section. */
for (const section of registry.SECTIONS) {
    const seen = new Set();
    for (const row of section.rows || []) {
        const sig = `${row.keys}::${row.cheatKey}`;
        if (seen.has(sig)) fail(`duplicate row in ${section.id}: ${row.keys} / ${row.cheatKey}`);
        seen.add(sig);
    }
}
console.log('  ok no duplicate rows within a section');

/* 4. Section ids are unique. */
const ids = new Set();
for (const section of registry.SECTIONS) {
    if (ids.has(section.id)) fail(`duplicate section id: ${section.id}`);
    ids.add(section.id);
}
console.log(`  ok ${ids.size} unique section ids`);

/* 5. `when` guards survive every feature-flag combination, including a bare
      dashboard where nothing is wired up yet. */
const bools = [true, false];
let combos = 0;
for (const inbox of bools) for (const health of bools) for (const config of bools)
for (const sideRail of bools) for (const tagCloud of bools) for (const inboxTabs of bools) {
    const dash = {
        activeView: 'bookmarks',
        settings: {
            buttonBarPosition: sideRail ? 'side-left' : 'bottom',
            inboxShowInPageTabs: inboxTabs,
        },
        inbox: { isEnabled: () => inbox, triage: { isOpen: () => false } },
        health: { isEnabled: () => health },
        config: { isEnabled: () => config },
        isTagCloudDesktopShortcutVisible: () => tagCloud,
    };
    try {
        const sections = registry.buildSections(dash, (_k, fb) => fb);
        if (!sections.length) fail(`no sections built for combination #${combos}`);
        for (const section of sections) {
            if (!section.items.length) fail(`empty section ${section.id} survived filtering`);
        }
    } catch (err) {
        fail(`buildSections threw for combination #${combos}: ${err.message}`);
    }
    combos++;
}
console.log(`  ok when-guards evaluated across ${combos} feature combinations`);

/* 6. A minimal dash (no features, no language) must not throw — this is the
      shape the registry sees before the dashboard finishes booting. */
try {
    const bare = registry.buildSections({}, undefined);
    if (!Array.isArray(bare)) fail('buildSections did not return an array for a bare dash');
} catch (err) {
    fail(`buildSections threw on a bare dash: ${err.message}`);
}
try {
    registry.buildSections(undefined, undefined);
} catch (err) {
    fail(`buildSections threw on undefined dash: ${err.message}`);
}
console.log('  ok bare/undefined dashboards do not throw');

/* 7. The printed sheet carries every key the registry has.

      It used to be a curated subset policed by a 70-row one-page budget, which
      made the paper a smaller product than the app: a key added to the modal was
      not on the sheet, and which keys made the cut was decided by whoever ran
      out of page first. The sheet takes as many pages as it needs now, so the
      check is coverage rather than a ceiling. */
const print = registry.buildPrintSections((_k, fb) => fb);
const printRows = print.reduce((n, s) => n + s.items.length, 0);
if (!print.length) fail('printable sheet built no sections');
for (const section of print) {
    if (!section.items.length) fail(`printable section ${section.id} has no rows`);
}
// Keyed by section as well as by keys: the same chord means different things in
// different views — Esc in Navigation and in Config, x on the grid and in the
// health list — so a key-only index answers for the wrong row.
const printedAt = (sections) => {
    const index = new Map();
    for (const section of sections) {
        for (const item of section.items) index.set(`${section.id}\u0000${item.keys}`, item.description);
    }
    return index;
};
const printedIndex = printedAt(print);
// Where a row actually prints: its own printSection wins, then the section's
// printMergeInto (the four command groups print as one), then the section.
const printedWhere = (section, row) =>
    `${row.printSection || section.printMergeInto || section.id}\u0000${row.printKeys || row.keys}`;
let omitted = 0;
for (const section of registry.SECTIONS) {
    for (const row of section.rows || []) {
        // printOmit is the one way off the sheet, and it is only for the command
        // palette's long tail. A keyboard shortcut carrying it is a mistake:
        // this sheet exists for the keys.
        if (row.printOmit) {
            omitted++;
            if (!String(row.keys).trim().startsWith(':')) {
                fail(`${section.id} → ${row.keys} is printOmit, but only palette commands may be`);
            }
            continue;
        }
        if (!printedIndex.has(printedWhere(section, row))) {
            fail(`printable sheet is missing ${section.id} → ${row.printKeys || row.keys}`);
        }
    }
}
if (omitted === 0) fail('nothing is omitted — the check above proves nothing');
console.log(`  ok printable sheet: ${print.length} sections, ${printRows} rows, `
    + `every key on it (${omitted} palette commands left off)`);

/* 8. A row's printFallback is what the sheet prints. It used to be handed to the
      label resolver as a *fallback*, where the resolver's own answer always won —
      and the generator's resolver answers from locales/en.json, a key the i18n
      check guarantees exists. So the curated short wording never reached the
      paper at all. Length is no longer the reason to want it; a printed row that
      reads in one line still is.

      Built with the generator's resolver, not the identity one used above: with
      `(_k, fb) => fb` a printFallback wins either way, and this check would pass
      against the very bug it exists to catch. */
const sheet = registry.buildPrintSections((key, fallback) => {
    const value = en.cheatsheet?.[key];
    return value && value !== key ? value : fallback;
});
// Row by row, and by the section the row prints in: two rows can share a long
// label — [ / ] and Alt + ← / → are the same action on different keys — and two
// sections can share a chord, so anything less specific answers for a neighbour.
const sheetIndex = printedAt(sheet);
let shortLabels = 0;
for (const section of registry.SECTIONS) {
    for (const row of section.rows || []) {
        if (!row.printFallback || row.printFallback === row.fallback) continue;
        shortLabels++;
        const printedText = sheetIndex.get(printedWhere(section, row));
        if (printedText !== row.printFallback) {
            fail(`printable sheet prints ${row.cheatKey} as "${printedText}", `
                + `expected its short label "${row.printFallback}"`);
        }
    }
}
if (shortLabels === 0) fail('no row carries a short print label — the check above proves nothing');
console.log(`  ok ${shortLabels} rows print their short label, not the modal sentence`);

if (errors.length) {
    console.error(`\nRegistry validation failed (${errors.length}):\n`);
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
}

console.log('Cheat sheet registry is valid.');
