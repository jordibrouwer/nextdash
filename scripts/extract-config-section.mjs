#!/usr/bin/env node
/**
 * Move a config section's members out of dashboard-config.js, verbatim.
 *
 * The section split is a cut and a paste: not one character of a method body
 * may change, because the failure mode this whole exercise exists to avoid is a
 * `this.<state>` quietly rewritten during a move. A model retyping three
 * thousand lines cannot promise that. A script that copies line ranges can, and
 * `--verify` proves it afterwards by comparing the bytes it wrote against the
 * bytes it removed.
 *
 * Two deliberate choices:
 *
 * 1. **Nothing is re-indented.** Methods keep their four-space indent inside
 *    the `Object.assign`, where eight would be conventional. Several of these
 *    methods hold multi-line template literals, and adding four spaces to every
 *    line would change the strings they produce. An object literal does not
 *    care about indentation; correctness does.
 * 2. **Comments travel with their member.** The block directly above a method
 *    is that method's explanation, and leaving it behind strands it in a file
 *    that no longer holds what it describes.
 *
 * Usage:
 *   node scripts/extract-config-section.mjs --section logs \
 *       --members logsTabLabel,renderLogsSection,... \
 *       --statics LOGS_TABS,ACTIVITY_CHANNEL_DEFAULTS \
 *       --ready DashboardConfigLogsReady \
 *       --title "Config → Logs: the server log and the activity trail."
 *
 *   node scripts/extract-config-section.mjs --section logs --verify
 *
 * Add --dry-run to see what would move without writing anything.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CORE = 'static/js/dashboard/dashboard-config.js';

// ─── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = { dryRun: false, verify: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') { out.dryRun = true; continue; }
        if (arg === '--verify') { out.verify = true; continue; }
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out[key] = argv[i + 1];
        i += 1;
    }
    return out;
}

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// ─── A scanner that knows what is code and what is not ──────────────────────

/*
 * Brace counting is the whole job, and a naive count is wrong on the first
 * method it meets: `{` appears inside strings, inside template literals (which
 * nest, via ${}), inside regexes and inside comments. This walks a line and
 * returns the depth change for the code parts only, carrying its state across
 * lines because block comments and template literals both span them.
 *
 * The one genuine ambiguity in JavaScript is `/`: divide, or the start of a
 * regex? It is settled the way every hand-written scanner settles it — by the
 * last meaningful character before it. After a value (an identifier, a number,
 * a closing bracket) it divides; after an operator, a comma or an opening
 * bracket it starts a regex.
 */
function makeScanner() {
    const state = {
        inBlockComment: false,
        // A stack, because `${}` inside a template can hold another template.
        templateDepth: [],
        prevMeaningful: '',
    };

    const startsRegex = (prev) => prev === '' || '=(,:[!&|?+-*%~^<>;{}'.includes(prev)
        || /[a-z]/.test(prev) === false;

    return function scanLine(line) {
        let depth = 0;
        let i = 0;
        const n = line.length;

        while (i < n) {
            const c = line[i];
            const next = line[i + 1];

            if (state.inBlockComment) {
                if (c === '*' && next === '/') { state.inBlockComment = false; i += 2; continue; }
                i += 1;
                continue;
            }

            // Inside a template literal, only `${` and the closing backtick matter.
            if (state.templateDepth.length && state.templateDepth.at(-1).inText) {
                if (c === '\\') { i += 2; continue; }
                if (c === '`') { state.templateDepth.pop(); i += 1; continue; }
                if (c === '$' && next === '{') {
                    state.templateDepth.at(-1).inText = false;
                    state.templateDepth.at(-1).braces = 0;
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }

            if (c === '/' && next === '/') break;            // line comment: done
            if (c === '/' && next === '*') { state.inBlockComment = true; i += 2; continue; }

            if (c === '"' || c === "'") {
                i += 1;
                while (i < n) {
                    if (line[i] === '\\') { i += 2; continue; }
                    if (line[i] === c) { i += 1; break; }
                    i += 1;
                }
                state.prevMeaningful = 'x';
                continue;
            }

            if (c === '`') {
                state.templateDepth.push({ inText: true, braces: 0 });
                i += 1;
                continue;
            }

            if (c === '/' && startsRegex(state.prevMeaningful)) {
                i += 1;
                let inClass = false;
                while (i < n) {
                    if (line[i] === '\\') { i += 2; continue; }
                    if (line[i] === '[') inClass = true;
                    else if (line[i] === ']') inClass = false;
                    else if (line[i] === '/' && !inClass) { i += 1; break; }
                    i += 1;
                }
                while (i < n && /[a-z]/.test(line[i])) i += 1;  // flags
                state.prevMeaningful = 'x';
                continue;
            }

            if (c === '{') {
                const top = state.templateDepth.at(-1);
                if (top && !top.inText) top.braces += 1;
                else depth += 1;
            } else if (c === '}') {
                const top = state.templateDepth.at(-1);
                if (top && !top.inText) {
                    if (top.braces === 0) { top.inText = true; }
                    else top.braces -= 1;
                } else {
                    depth -= 1;
                }
            }

            if (!/\s/.test(c)) state.prevMeaningful = c;
            i += 1;
        }
        return depth;
    };
}

// ─── Finding a member and where it ends ─────────────────────────────────────

/** Members of the class body sit at exactly four spaces. */
const memberStart = (line, name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^ {4}(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?\\*?${esc}\\s*[(=]`).test(line);
};

/**
 * The comment block and blank lines directly above a member belong to it.
 * Stops at the first line that is neither, so it never reaches back past the
 * member before it.
 */
function commentStartAbove(lines, at) {
    let start = at;
    let i = at - 1;
    // Walk back over a contiguous run of comment lines, allowing the blank line
    // that usually sits between members to stay behind.
    const isComment = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);
    while (i >= 0 && isComment(lines[i])) { start = i; i -= 1; }
    return start;
}

function findMember(lines, name, scanLine) {
    const at = lines.findIndex((l) => memberStart(l, name));
    if (at < 0) return null;

    // A second definition means the move would silently drop one of them.
    const again = lines.findIndex((l, i) => i > at && memberStart(l, name));
    if (again >= 0) {
        throw new Error(`${name} is defined twice (lines ${at + 1} and ${again + 1}) — resolve that first`);
    }

    let depth = 0;
    let seenBrace = false;
    let end = -1;
    for (let i = at; i < lines.length; i += 1) {
        const before = depth;
        depth += scanLine(lines[i]);
        if (depth > 0 || (before > 0 && depth === 0)) seenBrace = true;
        if (seenBrace && depth === 0) { end = i; break; }
        // A static field with no braces at all: `static X = 'y';`
        if (!seenBrace && depth === 0 && /;\s*(\/\/.*)?$/.test(lines[i])) { end = i; break; }
    }
    if (end < 0) throw new Error(`could not find the end of ${name} (starts at line ${at + 1})`);
    return { name, start: commentStartAbove(lines, at), declLine: at, end };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
if (!args.section) {
    console.error('need --section <id>');
    process.exit(2);
}

const modulePath = `static/js/dashboard/dashboard-config-${args.section}.js`;

if (args.verify) {
    if (!existsSync(modulePath)) {
        console.error(`no module at ${modulePath}`);
        process.exit(2);
    }
    /*
     * The proof that the move was a move. Every non-blank line of the module's
     * body must appear, byte for byte, in the core file as git last committed
     * it — so a body that was "tidied" on the way across fails here rather than
     * in a test three tasks later.
     */
    const { execSync } = await import('node:child_process');
    const original = execSync(`git show HEAD:${CORE}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
    const originalLines = new Set(original.split('\n'));
    const moduleBody = readFileSync(modulePath, 'utf8').split('\n');
    /*
     * Two lines the script writes are not copies, and both are accounted for
     * rather than waved through:
     *
     * - `    },` is a method's own closing brace with the object literal's
     *   separator on it. Strip that one comma and the line must match.
     * - `    global.DashboardConfig.X = …` is a moved static with its
     *   declaration rewritten; the rest of the line must match what followed
     *   `static ` in the original.
     */
    const asOriginal = (l) => {
        if (/^ {4}\},$/.test(l)) return '    }';
        const asStatic = l.replace(/^ {4}global\.DashboardConfig\./, '    static ');
        return originalLines.has(asStatic) ? asStatic : l;
    };
    const strays = moduleBody
        .map((l, i) => [l, i + 1])
        .filter(([l]) => l.trim() && !originalLines.has(asOriginal(l)));
    // The wrapper is ours, not moved, so it is expected to be new.
    const wrapper = /^(\(function|\s*'use strict'|\s*if \(typeof global|\s*Object\.assign|\s*\}\);|\}\(typeof window|\s*global\.\w+Ready = true;|\s*\*|\s*\/\*|\s*\/\/)/;
    const real = strays.filter(([l]) => !wrapper.test(l));
    if (real.length) {
        console.error(`${real.length} line(s) in ${modulePath} are not verbatim from ${CORE}:`);
        for (const [l, n] of real.slice(0, 20)) console.error(`  ${n}: ${l}`);
        process.exit(1);
    }
    console.log(`ok  every moved line in ${modulePath} is byte-identical to ${CORE} at HEAD`);
    process.exit(0);
}

const members = list(args.members);
const statics = list(args.statics);
if (!members.length && !statics.length) {
    console.error('need --members and/or --statics');
    process.exit(2);
}

const src = readFileSync(CORE, 'utf8');
const lines = src.split('\n');

const found = [];
for (const name of [...members, ...statics]) {
    const scanLine = makeScanner();
    const hit = findMember(lines, name, scanLine);
    if (!hit) {
        console.error(`not found in ${CORE}: ${name}`);
        process.exit(1);
    }
    hit.isStatic = statics.includes(name) || /^ {4}static\s/.test(lines[hit.declLine]);
    found.push(hit);
}

// Overlap would mean a brace count went wrong somewhere; better to stop.
const sorted = [...found].sort((a, b) => a.start - b.start);
for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start <= sorted[i - 1].end) {
        console.error(`ranges overlap: ${sorted[i - 1].name} and ${sorted[i].name}`);
        process.exit(1);
    }
}

const take = (m) => lines.slice(m.start, m.end + 1);

const protoMembers = found.filter((m) => !m.isStatic);
const staticMembers = found.filter((m) => m.isStatic);

const staticBlock = staticMembers.map((m) => {
    const body = take(m).join('\n');
    // `    static X = …;` becomes `    global.DashboardConfig.X = …;` — the one
    // line this script rewrites rather than copies, and it is one line.
    return body.replace(/^ {4}static\s+/m, '    global.DashboardConfig.');
}).join('\n\n');

const protoBlock = protoMembers.map((m) => take(m).join('\n')).join(',\n\n');

const title = args.title || `Config → ${args.section}.`;
const readyFlag = args.ready
    || `DashboardConfig${args.section.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}Ready`;

const moduleSource = `/**
 * ${title}
 *
 * Moved out of dashboard-config.js verbatim: same methods, same prototype, same
 * order. Only the moment the file arrives has changed — it is fetched when this
 * section is opened rather than on every visit to any other one.
 *
 * The bodies are not re-indented. Several of them build markup from multi-line
 * template literals, and shifting every line four spaces to the right would
 * change the strings they produce.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;
${staticBlock ? `\n${staticBlock}\n` : ''}
    Object.assign(global.DashboardConfig.prototype, {

${protoBlock}

    });

    global.${readyFlag} = true;
}(typeof window !== 'undefined' ? window : globalThis));
`;

// Remove from the bottom up, so earlier ranges keep their line numbers.
const remaining = [...lines];
for (const m of [...found].sort((a, b) => b.start - a.start)) {
    let from = m.start;
    let to = m.end;
    // Take the blank line the member left behind with it, so the core file does
    // not collect a run of empty lines where sections used to be.
    if (remaining[to + 1] !== undefined && remaining[to + 1].trim() === '') to += 1;
    else if (from > 0 && remaining[from - 1].trim() === '') from -= 1;
    remaining.splice(from, to - from + 1);
}

const movedLines = found.reduce((n, m) => n + (m.end - m.start + 1), 0);

if (args.dryRun) {
    console.log(`would move ${found.length} members (${movedLines} lines) to ${modulePath}:`);
    for (const m of sorted) {
        console.log(`  ${m.isStatic ? 'static' : 'proto '} ${m.name.padEnd(30)} lines ${m.start + 1}-${m.end + 1}`);
    }
    console.log(`${CORE}: ${lines.length} -> ${remaining.length} lines`);
    process.exit(0);
}

writeFileSync(modulePath, moduleSource);
writeFileSync(CORE, remaining.join('\n'));

console.log(`moved ${found.length} members (${movedLines} lines) to ${modulePath}`);
console.log(`${CORE}: ${lines.length} -> ${remaining.length} lines`);
console.log('next: node --check both files, then the census diff, then --verify');
