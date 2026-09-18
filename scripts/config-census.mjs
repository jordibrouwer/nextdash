#!/usr/bin/env node
/**
 * Every member of DashboardConfig, so a move can be checked against a move.
 *
 * Parsed rather than imported: the file is a browser script with no exports,
 * and loading it here would need a DOM.
 *
 * The census is the cheap gate on the section split. Run it before a move,
 * run it after with the new module named on the command line, and diff the
 * two — an empty diff is the only acceptable result. A member that vanished,
 * appeared or was renamed shows up as a line, which is the failure the split
 * exists to catch and the one a passing test suite would not.
 *
 *   node scripts/config-census.mjs > /tmp/before.txt
 *   node scripts/config-census.mjs static/js/dashboard/dashboard-config-logs.js > /tmp/after.txt
 *   diff /tmp/before.txt /tmp/after.txt
 *
 * Accessors are tagged by kind (`proto:get:x`, `proto:set:x`) so a dropped
 * setter cannot hide behind a surviving getter of the same name.
 */
import { readFileSync } from 'node:fs';

const CORE = 'static/js/dashboard/dashboard-config.js';

/*
 * Members sit at four spaces in the class body, and — because the extractor
 * deliberately does not re-indent what it moves — at four spaces inside a
 * module's `Object.assign` too. One indent level, one set of patterns.
 *
 * That leaves keywords: `if (…) {` and friends also sit at four spaces inside
 * a module wrapper and look exactly like a method declaration. They are named
 * here rather than guessed at.
 */
const KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'return',
    'function', 'with', 'Object', 'global', 'window',
]);

const out = new Set();

/*
 * A module file holds up to two Object.assign blocks: one against the prototype
 * and one against the class. Members sit at the same indent in both, so which
 * block we are inside is the only thing that says whether a name is a method or
 * a static — and getting that wrong reports a static as having become a
 * prototype member, which is exactly the kind of silent change this census
 * exists to catch.
 */
function scan(lines) {
    let assignTarget = null;
    lines.forEach((line) => {
        if (/Object\.assign\(global\.DashboardConfig\.prototype/.test(line)) { assignTarget = 'proto'; return; }
        if (/Object\.assign\(global\.DashboardConfig\s*,/.test(line)) { assignTarget = 'static'; return; }
        if (/^ {4}\}\);?,?\s*$/.test(line)) { assignTarget = null; return; }
        // static NAME = …
        const field = line.match(/^ {4}static\s+([A-Za-z_]\w*)\s*=/);
        if (field) { out.add(`static:${field[1]}`); return; }

        // A moved static, rewritten by the extractor as an assignment.
        const movedStatic = line.match(/^ {4}global\.DashboardConfig\.([A-Za-z_]\w*)\s*=/);
        if (movedStatic) { out.add(`static:${movedStatic[1]}`); return; }

        // get x() / set x() / static get x()
        const accessor = line.match(/^ {4}(static\s+)?(get|set)\s+([A-Za-z_]\w*)\s*\(/);
        if (accessor) {
            const isStatic = Boolean(accessor[1]) || assignTarget === 'static';
            out.add(`${isStatic ? 'static' : 'proto'}:${accessor[2]}:${accessor[3]}`);
            return;
        }

        // A method declaration: name, then an argument list, then an opening brace.
        const method = line.match(/^ {4}(static\s+)?(async\s+)?\*?([A-Za-z_]\w*)\s*\(/);
        if (method && !KEYWORDS.has(method[3])) {
            const isStatic = Boolean(method[1]) || assignTarget === 'static';
            out.add(`${isStatic ? 'static' : 'proto'}:${method[3]}`);
        }
    });
}

scan(readFileSync(CORE, 'utf8').split('\n'));
for (const file of process.argv.slice(2)) {
    scan(readFileSync(file, 'utf8').split('\n'));
}

console.log([...out].sort().join('\n'));
