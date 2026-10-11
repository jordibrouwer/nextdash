#!/usr/bin/env node
'use strict';

/**
 * Fixed sleeps in the e2e suite, checked.
 *
 * `page.waitForTimeout(n)` waits n milliseconds whether the app is ready or
 * not. Too short and the test is flaky on a slow runner; long enough and it
 * spends that time on every run, on every shard. The suite carried 650 of
 * them before they were replaced with waits on the state each one was really
 * waiting for: a tab's aria-selected, a save's response, a polled value.
 *
 * A fixed wait is still the right tool in two places. Before a check that
 * something does NOT happen -- no request, no menu, nothing drawn -- because
 * without it the check passes at once and proves nothing. And where the test
 * is about time itself: a debounce, an auto-hide, an expiry. Those stay, and
 * they say so: every waitForTimeout needs a `//` comment directly above it,
 * with only comment lines in between, saying why the clock and not a
 * condition. A bare sleep fails this check.
 *
 * Exit 1 on any bare sleep. This runs in CI.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const testsDir = path.join(root, 'tests');

// Files that are allowed bare sleeps, with the reason.
const EXEMPT = new Map([
    // Only runs with MANUAL_SHOTS set and never in CI; the sleeps let the page
    // settle visually before a screenshot for the manual is taken.
    ['manual-screenshots.spec.js', 'screenshots for the manual, never run in CI'],
]);

const SLEEP = /\bwaitForTimeout\s*\(/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const LOOKBACK = 3;

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
    }
    return out;
}

const problems = [];
for (const file of walk(testsDir)) {
    const rel = path.relative(root, file);
    if (EXEMPT.has(path.basename(file))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (!SLEEP.test(line) || COMMENT.test(line)) return;
        let explained = false;
        for (let j = i - 1; j >= Math.max(0, i - LOOKBACK); j--) {
            if (COMMENT.test(lines[j])) { explained = true; break; }
            if (lines[j].trim() !== '') break;
        }
        if (!explained) problems.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
}

if (problems.length) {
    console.error(`${problems.length} fixed wait(s) without a reason:\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`
Wait for the state instead: expect(locator).toBeVisible() / toHaveAttribute(),
expect.poll(() => page.evaluate(...)), or page.waitForResponse(...).
If the wait guards a check that something does NOT happen, or the test is
about time itself, keep it and put a // comment directly above saying why.`);
    process.exit(1);
}
console.log('validate-test-waits: every fixed wait says why');
