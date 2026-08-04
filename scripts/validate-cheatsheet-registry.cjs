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

/* 7. The printable subset stays a subset, and stays small enough for one page. */
const print = registry.buildPrintSections((_k, fb) => fb);
const printRows = print.reduce((n, s) => n + s.items.length, 0);
if (!print.length) fail('printable sheet built no sections');
const PRINT_ROW_BUDGET = 70;
if (printRows > PRINT_ROW_BUDGET) {
    fail(`printable sheet has ${printRows} rows, over the ${PRINT_ROW_BUDGET}-row one-page budget`);
}
console.log(`  ok printable subset: ${print.length} sections, ${printRows} rows`);

if (errors.length) {
    console.error(`\nRegistry validation failed (${errors.length}):\n`);
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
}

console.log('Cheat sheet registry is valid.');
