/**
 * The section planner, checked against the one split that has already happened.
 *
 * Logs is the ground truth this test exists for. The implementation plan listed
 * eighteen names for that section and three of them were wrong: `computeActivity`
 * and `bindActivityChartTooltip` are reached from Stats, and `LOGS_TABS` is read
 * by `SUB_TABS`, a class-level getter that runs before any section module can
 * have arrived. Moving them broke every section in the app with
 * `this.computeActivity is not a function`, and the census diff, `node --check`
 * and the parse check all passed while it was broken.
 *
 * So the planner is run here against the file as it stood *before* that split,
 * fed the same wrong list, and required to catch exactly those three. If it ever
 * stops catching them, it has stopped being worth running.
 *
 * Run with: node tests/config-section-plan.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { indexMembers, makeScanner } from '../scripts/lib/config-members.mjs';

const CORE = 'static/js/dashboard/dashboard-config.js';
let failures = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ok  ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`  FAIL ${name}`);
        console.error(`       ${err.message}`);
    }
}

// ─── The scanner ────────────────────────────────────────────────────────────

console.log('scanner');

test('counts braces in plain code', () => {
    const scan = makeScanner();
    assert.strictEqual(scan('function f() {'), 1);
    assert.strictEqual(scan('}'), -1);
});

test('ignores braces inside strings', () => {
    const scan = makeScanner();
    assert.strictEqual(scan(`const a = "{{{";`), 0);
    assert.strictEqual(scan(`const b = '}}}';`), 0);
});

test('ignores braces inside line and block comments', () => {
    const scan = makeScanner();
    assert.strictEqual(scan('const a = 1; // {{{'), 0);
    const scan2 = makeScanner();
    assert.strictEqual(scan2('/* { { { */'), 0);
});

test('carries a block comment across lines', () => {
    const scan = makeScanner();
    assert.strictEqual(scan('/* opening'), 0);
    assert.strictEqual(scan('  still { inside'), 0);
    assert.strictEqual(scan('  closing */ {'), 1);
});

test('handles a template literal with an interpolation', () => {
    const scan = makeScanner();
    // The `${}` braces cancel out; the trailing `{` is real.
    assert.strictEqual(scan('const s = `a ${b} c`; if (x) {'), 1);
});

test('carries a multi-line template literal', () => {
    const scan = makeScanner();
    assert.strictEqual(scan('const s = `'), 0);
    assert.strictEqual(scan('   <div class="{ not code }">'), 0);
    assert.strictEqual(scan('   ${x ? "y" : "z"}'), 0);
    assert.strictEqual(scan('`;'), 0);
});

test('does not read a regex as the start of a comment or string', () => {
    const scan = makeScanner();
    assert.strictEqual(scan('const r = /[{}]/g;'), 0);
    const scan2 = makeScanner();
    assert.strictEqual(scan2('const r = /a"b/; function f() {'), 1);
});

test('treats a slash after a value as division, not a regex', () => {
    const scan = makeScanner();
    assert.strictEqual(scan('const half = total / 2; if (half) {'), 1);
});

// ─── The member index ───────────────────────────────────────────────────────

console.log('member index');

const { lines: coreLines, members, byName } = indexMembers(CORE);

test('finds a plausible number of members', () => {
    assert.ok(members.length > 700, `only ${members.length} members found`);
});

test('separates statics from prototype members', () => {
    const statics = members.filter((m) => m.isStatic);
    assert.ok(statics.length > 50, `only ${statics.length} statics found`);
    assert.ok(byName.has('SECTIONS'), 'SECTIONS not indexed');
    assert.ok(byName.get('SECTIONS')[0].isStatic, 'SECTIONS not marked static');
});

test('indexes accessors', () => {
    assert.ok(byName.has('SUB_TABS'), 'the SUB_TABS getter was not indexed');
    assert.ok(byName.get('SUB_TABS')[0].isAccessor, 'SUB_TABS not marked as an accessor');
});

test('records the statics a member reads', () => {
    const subTabs = byName.get('SUB_TABS')[0];
    assert.ok(subTabs.reads.has('LOGS_TABS'),
        'SUB_TABS reads DashboardConfig.LOGS_TABS and the index did not see it');
});

test('records the methods a member calls', () => {
    const withCalls = members.filter((m) => m.calls.size > 0);
    assert.ok(withCalls.length > 300, `only ${withCalls.length} members call anything`);
});

test('member ranges never overlap', () => {
    const sorted = [...members].sort((a, b) => a.declLine - b.declLine);
    for (let i = 1; i < sorted.length; i += 1) {
        assert.ok(sorted[i].declLine > sorted[i - 1].end,
            `${sorted[i - 1].name} (ends ${sorted[i - 1].end + 1}) overlaps ${sorted[i].name} (starts ${sorted[i].declLine + 1})`);
    }
});

test('every method ends on a line that closes it', () => {
    const bad = members
        .filter((m) => !m.isStatic)
        .filter((m) => !/^\s*\}/.test(coreLines[m.end]))
        .map((m) => `${m.name} ends at line ${m.end + 1}: ${JSON.stringify(coreLines[m.end])}`);
    assert.deepStrictEqual(bad, [], `${bad.length} method(s) end on a line that is not a closing brace`);
});

test('a method body really is between its declaration and its end', () => {
    // renderShell is long, holds template literals and is not going anywhere,
    // so it is a fair check that the range covers the whole method and no more.
    const shell = byName.get('renderShell')?.[0];
    assert.ok(shell, 'renderShell was not indexed');
    assert.match(coreLines[shell.declLine], /^ {4}renderShell\s*\(/);
    assert.strictEqual(coreLines[shell.end], '    }');
    assert.ok(shell.lineCount > 20, `renderShell measured only ${shell.lineCount} lines`);
});

// ─── The planner, against the split that already happened ───────────────────

console.log('planner (ground truth: the logs split)');

/*
 * The pre-split file, taken from the commit before Logs moved. Reconstructed
 * from git rather than kept as a fixture: a fixture would drift, and the point
 * is to check the planner against what was really there.
 */
const PRE_SPLIT_COMMIT = '1416a838';
let preSplit = null;
try {
    preSplit = execFileSync('git', ['show', `${PRE_SPLIT_COMMIT}:${CORE}`],
        { encoding: 'utf8', maxBuffer: 1 << 28 });
} catch {
    console.log('  skip  the pre-split commit is not in this clone');
}

if (preSplit) {
    const dir = mkdtempSync(join(tmpdir(), 'config-plan-'));
    const path = join(dir, 'presplit.js');
    writeFileSync(path, preSplit);

    // The list the implementation plan gave for Logs, wrong names and all.
    const PLANNED = ['logsTabLabel', 'renderLogsSection', 'renderLogsTab', 'renderActivityTrail',
        'bindActivityResetButton', 'syncActivityResetButton', 'activityChannelsAreDefault',
        'serverLogLiveNote', 'serverLogFloorNote', 'renderServerLogTiles', 'logRetentionLabel',
        'renderServerLogLines', 'bindLogSettingsPopover', 'bindActivityTrailControls',
        'computeActivity', 'bindActivityChartTooltip', 'LOGS_TABS', 'ACTIVITY_CHANNEL_DEFAULTS'];

    let report;
    let exitCode = 0;
    try {
        report = execFileSync('node', ['scripts/config-section-plan.mjs',
            '--file', path, '--section', 'logs', '--members', PLANNED.join(','), '--json'],
        { encoding: 'utf8' });
    } catch (err) {
        report = err.stdout;
        exitCode = err.status;
    }
    const result = JSON.parse(report);

    test('refuses the list, rather than passing it', () => {
        assert.strictEqual(exitCode, 1, 'the planner exited 0 on a list that broke the app');
    });

    test('catches computeActivity, which belongs to Stats', () => {
        assert.ok(result.wrong.some((w) => w.name === 'computeActivity'),
            'computeActivity was not flagged');
    });

    test('catches bindActivityChartTooltip, which belongs to Stats', () => {
        assert.ok(result.wrong.some((w) => w.name === 'bindActivityChartTooltip'),
            'bindActivityChartTooltip was not flagged');
    });

    test('catches LOGS_TABS, which SUB_TABS reads at class level', () => {
        const hit = result.wrong.find((w) => w.name === 'LOGS_TABS');
        assert.ok(hit, 'LOGS_TABS was not flagged');
        assert.match(hit.why, /SUB_TABS/, `LOGS_TABS flagged, but not for the right reason: ${hit.why}`);
    });

    test('catches logsTabLabel, which the settings search reaches ungated', () => {
        /*
         * The one the first split shipped with, and the planner found later.
         * `subTabLabel` dispatches on section, so it looks section-scoped — but
         * `cacheSettingsJumpFields` runs from `afterRender` and asks it for every
         * section's labels at once, logs included, while the reader is somewhere
         * else entirely. Nothing behind `ensureSection` guards that path.
         */
        const hit = result.wrong.find((w) => w.name === 'logsTabLabel');
        assert.ok(hit, 'logsTabLabel was not flagged');
        assert.match(hit.why, /core before any module loads/, `flagged for the wrong reason: ${hit.why}`);
    });

    test('flags those four and nothing else', () => {
        const names = result.wrong.map((w) => w.name).sort();
        assert.deepStrictEqual(names,
            ['LOGS_TABS', 'bindActivityChartTooltip', 'computeActivity', 'logsTabLabel'].sort(),
            'the planner flagged a different set than the ones that are genuinely unsafe');
    });

    test('the names it leaves are the ones that are actually section-scoped', () => {
        const flagged = new Set(result.wrong.map((w) => w.name));
        const kept = PLANNED.filter((n) => !flagged.has(n));
        assert.strictEqual(kept.length, 14, `kept ${kept.length} names, expected 14`);
        assert.ok(kept.includes('renderLogsSection'), 'the anchor was dropped');
        assert.ok(kept.includes('ACTIVITY_CHANNEL_DEFAULTS'), 'the section\'s own static was dropped');
    });

    rmSync(dir, { recursive: true, force: true });
}

// ─── The second thing the tool found, against the live file ─────────────────

console.log('planner (ground truth: the help split)');

/*
 * `bindHelpActions` is named for Help, is called by Help, and sits among Help's
 * own binders — and `afterRender` also calls it under `this.section === 'about'`.
 * Moved into the Help module it took About with it, and twenty specs that never
 * mention Help failed with `this.bindHelpActions is not a function`. The planner
 * has to read dispatcher branches to see that, so this pins that it still does.
 */
{
    let report;
    try {
        report = execFileSync('node', ['scripts/config-section-plan.mjs',
            '--section', 'help', '--members', 'bindHelpActions,renderHelp', '--json'],
        { encoding: 'utf8' });
    } catch (err) {
        report = err.stdout;
    }
    const result = JSON.parse(report);

    test('catches bindHelpActions, which a dispatcher calls for About', () => {
        const hit = result.wrong.find((w) => w.name === 'bindHelpActions');
        assert.ok(hit, 'bindHelpActions was not flagged');
        assert.match(hit.why, /about/, `flagged for the wrong reason: ${hit.why}`);
    });

    test('still lets renderHelp through', () => {
        assert.ok(!result.wrong.some((w) => w.name === 'renderHelp'),
            'renderHelp was flagged, so the section cannot be split at all');
    });
}

console.log('');
if (failures) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
}
console.log('all checks passed');
