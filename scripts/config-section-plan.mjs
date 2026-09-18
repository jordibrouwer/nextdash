#!/usr/bin/env node
/**
 * Work out which members of dashboard-config.js belong to one section alone.
 *
 * The gate that was missing when Logs was split, and the reason it was missing
 * is instructive: the census diff, `node --check` and the parse check all passed
 * on a move that broke every section in the app. Three of the eighteen names the
 * plan listed for Logs did not belong to Logs — `computeActivity` and
 * `bindActivityChartTooltip` are reached from the Stats section, and `LOGS_TABS`
 * is read by `SUB_TABS`, a class-level getter eight call sites reach before any
 * module can have loaded. All three resolve by name on the prototype, so nothing
 * mechanical noticed; a browser did, with `this.computeActivity is not a
 * function`.
 *
 * The question is not "does the core call this" — the core is supposed to call
 * into a section, and `ensureSection` is awaited before it does. The question is
 * whether anything reaches it that is NOT gated behind that await: another
 * section, or class-level code.
 *
 * So ownership is computed rather than guessed. From each section's anchor,
 * follow `this.x()` calls transitively. A member reached from exactly one anchor
 * belongs to that section and can move. A member reached from two or more is
 * shared and stays in the core, whatever its name suggests.
 *
 *   node scripts/config-section-plan.mjs --section help
 *   node scripts/config-section-plan.mjs --section help --members renderHelp,…   (audit a list)
 *   node scripts/config-section-plan.mjs --section help --json
 *
 * Exit 0 when the proposed set is safe, 1 when it is not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { indexMembers, memberAt, CORE } from './lib/config-members.mjs';

/*
 * Where each section starts. Everything a section owns is reached from here and
 * from nowhere else; this table is the only hand-written input the analysis has,
 * and a wrong entry shows up as a section that owns almost nothing.
 */
const ANCHORS = {
    overview: ['renderOverview', 'bindOverviewActions'],
    appearance: ['renderAppearance', 'bindAppearanceControls'],
    bookmarks: ['renderBookmarksSection', 'renderBookmarksList', 'bindBookmarksSection', 'bindBookmarksListTab'],
    structure: ['renderPagesTags', 'bindPagesTags'],
    behavior: ['renderBehavior', 'bindBehaviorControls', 'bindBehaviorActions'],
    'data-backups': ['renderDataBackups', 'bindDataBackupsActions'],
    widgets: ['renderWidgetsSection', 'bindWidgetsTabs', 'bindWidgetsEditor'],
    stats: ['renderStats', 'bindStats'],
    help: ['renderHelp', 'bindHelp', 'bindHelpSearch', 'bindHelpActions'],
    logs: ['renderLogsSection', 'bindLogsActions', 'bindLogsTabContent'],
    about: ['renderAbout', 'bindAboutTabs'],
};

/*
 * Shared machinery every section draws through. Following calls into these
 * would make every section reach every other one, so the walk stops here. They
 * are the same names the design doc lists as staying in the core.
 */
const SHARED = new Set([
    't', 'notify', 'writeFetch', 'confirmAction', 'guardUniqueName',
    'saveSettingsWithFeedback', 'renderShell', 'renderSection', 'renderTile',
    'renderControlPanels', 'panelsFor', 'setBehavior', 'behaviorSchema',
    'escape', 'render', 'setSection', 'restoreConfigHash', 'ensureSection',
    'loadAndRender', 'openConfigView', 'subTabLabel', 'saveSettings',
    'trackAction', '_trackAction', 'settings', 'apiFetch',
    /*
     * Generic repainters. `repaintActiveControlPanels` redraws whichever section
     * is open — `this.section`, guarded by `isActiveView()` — so following it
     * makes Appearance reach Structure's editors and Behavior reach Appearance's
     * themes. Before these were walls the script reported that Appearance owned
     * nothing at all, which was an artefact of the walk rather than a fact about
     * the code.
     */
    'repaintActiveControlPanels', 'captureControlPanelFocus', 'isActiveView',
    'bindChangedFilter', 'repaintSectionBody',
]);

/*
 * Navigation, not dependency.
 *
 * `handleOverviewGo` is the overview's "take me to that setting" button and it
 * jumps into every section by design; `activateSettingsJumpEntry` is the
 * settings search doing the same. Following those edges makes every section
 * reach every other one, which is why an earlier run of this script reported
 * that Appearance owned nothing at all. They both travel through `setSection`,
 * which awaits `ensureSection`, so what they reach is reached after the module
 * has landed — a wall, like renderSection.
 */
const NAVIGATORS = ['handleOverviewGo', 'activateSettingsJumpEntry', 'selectSection',
    'openSettingsJumpEntry', 'jumpToSetting'];

function parseArgs(argv) {
    const out = { json: false };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') { out.json = true; continue; }
        if (a === '--verbose') { out.verbose = true; continue; }
        if (!a.startsWith('--')) continue;
        out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
        i += 1;
    }
    return out;
}

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const args = parseArgs(process.argv.slice(2));
if (!args.section || !ANCHORS[args.section]) {
    console.error(`usage: --section <${Object.keys(ANCHORS).join('|')}> [--members a,b] [--file path] [--json]`);
    process.exit(2);
}

const sourceFile = args.file || CORE;
const { lines, members, byName } = indexMembers(sourceFile);
const method = (name) => byName.get(name)?.find((m) => !m.isStatic);

/** Every member reachable from a set of entry points, stopping at SHARED. */
function reachable(entries) {
    const seen = new Set();
    const queue = entries.filter((n) => method(n));
    const entrySet = new Set(entries);
    while (queue.length) {
        const name = queue.shift();
        // A navigator is a wall on the way out, but an anchor of this section is
        // where the walk starts, so it is never a wall for its own section.
        if (seen.has(name) || SHARED.has(name)) continue;
        if (NAVIGATORS.includes(name) && !entrySet.has(name)) continue;
        seen.add(name);
        const m = method(name);
        if (!m) continue;
        for (const called of m.calls) {
            if (!seen.has(called) && !SHARED.has(called) && method(called)) queue.push(called);
        }
    }
    return seen;
}

/*
 * Which section a dispatcher's branches claim.
 *
 * `afterRender` is a chain of `if (this.section === 'x') … else if (…)`, and the
 * branch a call sits in is the section that call belongs to. Without reading the
 * branches, `bindHelpActions` looks like one of Help's own anchors — it is named
 * for Help and Help does call it — while `afterRender` also calls it under
 * `section === 'about'`. Moving it into the Help module took About with it, and
 * twenty specs that never mention Help answered with
 * `this.bindHelpActions is not a function`.
 *
 * So the branches are read. A name claimed by two different sections is shared,
 * whatever its own name suggests.
 */
const DISPATCHERS = ['afterRender', 'bindSectionBody', 'repaintSectionBody'];

const branchClaims = new Map();   // called name -> Set of section ids
for (const dispatcher of DISPATCHERS) {
    const m = method(dispatcher);
    if (!m) continue;
    let current = null;
    for (let i = m.declLine; i <= m.end; i += 1) {
        const line = lines[i];
        const test = line.match(/this\.section === '([\w-]+)'/);
        if (test) current = test[1];
        else if (/^ {8}\} else \{/.test(line)) current = null;
        if (!current) continue;
        for (const call of line.matchAll(/this\.([A-Za-z_]\w*)\s*\??\.?\s*\(/g)) {
            if (!branchClaims.has(call[1])) branchClaims.set(call[1], new Set());
            branchClaims.get(call[1]).add(current);
        }
    }
}

/*
 * Names the rest of the app reaches directly.
 *
 * `dashboard-config-loader.js` stands in for the module before it loads and
 * forwards a list of methods by name; the dashboard, the keyboard layer and the
 * command palette call others through `config.<name>()`. None of that is
 * visible from inside dashboard-config.js, which is why `closeConfigView` —
 * the app's own way of leaving config — came through the analysis as one of
 * Help's to move.
 *
 * Anything named outside this file stays in the core, whichever section owns it
 * on paper.
 */
const externallyCalled = (() => {
    const names = new Set();
    const skip = /dashboard-config(-[a-z]+)?\.js$/;
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (!entry.endsWith('.js') || skip.test(entry)) continue;
            const src = readFileSync(full, 'utf8');
            for (const m of src.matchAll(/\bconfig\s*\??\.\s*([A-Za-z_]\w*)\s*\??\.?\s*\(/g)) names.add(m[1]);
        }
    };
    walk('static/js');
    // The loader's own forwarding list: `name(...args) { return this._module?.name?.(...) }`
    try {
        const loader = readFileSync('static/js/dashboard/dashboard-config-loader.js', 'utf8');
        for (const m of loader.matchAll(/this\._module\s*\??\.\s*([A-Za-z_]\w*)\s*\??\.?\s*\(/g)) names.add(m[1]);
    } catch { /* no loader in this tree */ }
    return names;
})();

const reach = {};
for (const [id, entries] of Object.entries(ANCHORS)) reach[id] = reachable(entries);

/*
 * What the core reaches without waiting for any module.
 *
 * `ensureSection` is awaited on the way into a section's draw, so everything
 * `renderSection` dispatches to is safe. Nothing else is. `loadAndRender` in
 * particular fetches each section's data before the draw — that is how
 * `loadLatestRelease` came to be called from `loadOverviewData` while the
 * planner had it down as Help's alone, and the smoke spec answered with
 * `this.loadLatestRelease is not a function` on the overview.
 *
 * So the walk starts from the entry points that are NOT gated and stops at the
 * ones that are. Anything it reaches has to stay in the core.
 */
/*
 * `afterRender` is the one that cost the most to learn. It runs after every
 * render, for whatever section is drawn, and calls section binders by name
 * without checking whether their module has arrived. Listing it as shared
 * machinery made the walk stop there and hid `bindHelpActions` — which then
 * shipped, and answered with `this.bindHelpActions is not a function` on twenty
 * specs that have nothing to do with Help. It is a root, not a wall.
 */
const UNGATED_ROOTS = ['loadAndRender', 'openConfigView', 'render', 'renderShell',
    'setSection', 'loadOverviewData', 'refreshStatus', 'init', 'afterRender',
    'repaintActiveControlPanels', 'bindChangedFilter'];
const GATED = new Set(['renderSection', ...NAVIGATORS, ...Object.values(ANCHORS).flat()]);

const coreReachable = (() => {
    const seen = new Set();
    const queue = UNGATED_ROOTS.filter((n) => method(n));
    while (queue.length) {
        const name = queue.shift();
        if (seen.has(name) || GATED.has(name)) continue;
        seen.add(name);
        for (const called of method(name)?.calls || []) {
            if (!seen.has(called) && !GATED.has(called) && method(called)) queue.push(called);
        }
    }
    return seen;
})();

const mine = reach[args.section];
const others = Object.entries(reach).filter(([id]) => id !== args.section);

/** Which other sections also reach this member. */
const sharedWith = (name) => others.filter(([, set]) => set.has(name)).map(([id]) => id);

// ─── Ownership ──────────────────────────────────────────────────────────────

const owned = [];
const shared = [];
for (const name of [...mine].sort()) {
    const also = sharedWith(name);
    if (also.length) { shared.push({ name, also }); continue; }
    if (coreReachable.has(name)) { shared.push({ name, also: ['the core, before any module loads'] }); continue; }
    const claims = branchClaims.get(name);
    if (claims && (claims.size > 1 || !claims.has(args.section))) {
        shared.push({ name, also: [`claimed by ${[...claims].join(', ')} in a dispatcher branch`] });
        continue;
    }
    if (externallyCalled.has(name)) {
        shared.push({ name, also: ['called from outside dashboard-config.js'] });
        continue;
    }
    owned.push(name);
}

// ─── Statics ────────────────────────────────────────────────────────────────

const ownedSet = new Set(owned);
const statics = [];
for (const m of members.filter((x) => x.isStatic)) {
    const readers = members.filter((x) => x.reads.has(m.name));
    const readerNames = readers.map((x) => x.name);
    if (!readerNames.some((n) => ownedSet.has(n))) continue;   // not this section's at all

    const outside = readerNames.filter((n) => !ownedSet.has(n));
    // A read that sits outside any member body is class-level: it runs while the
    // class is being defined, long before any module could have arrived.
    const classLevel = lines
        .map((l, i) => [l, i])
        .filter(([l, i]) => l.includes(`DashboardConfig.${m.name}`) && !memberAt(members, i))
        .map(([, i]) => i + 1);

    statics.push({
        name: m.name,
        movable: outside.length === 0 && classLevel.length === 0,
        outside,
        classLevel,
    });
}

// ─── Auditing a proposed list ───────────────────────────────────────────────

const proposed = list(args.members);
const wrong = [];
if (proposed.length) {
    for (const name of proposed) {
        if (!byName.has(name)) { wrong.push({ name, why: 'not found in the file' }); continue; }
        const isStatic = byName.get(name)[0].isStatic;
        if (isStatic) {
            const s = statics.find((x) => x.name === name);
            if (!s) wrong.push({ name, why: 'no member of this section reads it' });
            else if (!s.movable) {
                wrong.push({
                    name,
                    why: [s.outside.length ? `read by ${s.outside.slice(0, 4).join(', ')}` : '',
                        s.classLevel.length ? `read at class level (line ${s.classLevel[0]})` : '']
                        .filter(Boolean).join('; '),
                });
            }
            continue;
        }
        if (!mine.has(name)) { wrong.push({ name, why: `not reachable from ${ANCHORS[args.section].join('/')}` }); continue; }
        const also = sharedWith(name);
        if (also.length) { wrong.push({ name, why: `also reached from ${also.join(', ')}` }); continue; }
        if (coreReachable.has(name)) {
            wrong.push({ name, why: 'reached from the core before any module loads' });
            continue;
        }
        const claims = branchClaims.get(name);
        if (claims && (claims.size > 1 || !claims.has(args.section))) {
            wrong.push({ name, why: `a dispatcher calls it for ${[...claims].join(', ')}` });
            continue;
        }
        if (externallyCalled.has(name)) {
            wrong.push({ name, why: 'called from outside dashboard-config.js (the loader, or another module)' });
        }
    }
}

// ─── Report ─────────────────────────────────────────────────────────────────

const lineCount = owned.reduce((n, name) => n + (method(name)?.lineCount || 0), 0);
const movableStatics = statics.filter((s) => s.movable).map((s) => s.name);

if (args.json) {
    console.log(JSON.stringify({
        section: args.section,
        owned,
        statics,
        wrong,
        lines: lineCount,
        sharedCount: shared.length,
        shared: args.verbose ? shared : undefined,
    }, null, 2));
    process.exit(wrong.length ? 1 : 0);
}

console.log(`section ${args.section} — anchored on ${ANCHORS[args.section].join(', ')}\n`);

if (proposed.length) {
    if (wrong.length) {
        console.log(`${wrong.length} of ${proposed.length} proposed names must NOT move:`);
        for (const w of wrong) console.log(`  ✗ ${w.name} — ${w.why}`);
    } else {
        console.log(`all ${proposed.length} proposed names are owned by this section.`);
    }
    console.log('');
}

console.log(`${owned.length} members owned outright (${lineCount} lines).`);

if (shared.length) {
    console.log(`\n${shared.length} reached from here but shared, so they stay in the core:`);
    for (const s of shared.slice(0, 12)) console.log(`  · ${s.name} — also ${s.also.join(', ')}`);
    if (shared.length > 12) console.log(`  · … and ${shared.length - 12} more`);
}

if (statics.length) {
    console.log('\nstatics this section reads:');
    for (const s of statics) {
        if (s.movable) console.log(`  ✓ ${s.name} — read only from here, can move`);
        else console.log(`  · ${s.name} — stays (${s.classLevel.length ? `class level, line ${s.classLevel[0]}` : `read by ${s.outside.slice(0, 3).join(', ')}`})`);
    }
}

console.log('\nnode scripts/extract-config-section.mjs \\');
console.log(`    --section ${args.section} \\`);
console.log(`    --members ${owned.join(',')} \\`);
if (movableStatics.length) console.log(`    --statics ${movableStatics.join(',')} \\`);
console.log(`    --ready DashboardConfig${args.section.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}Ready`);

process.exit(wrong.length ? 1 : 0);
