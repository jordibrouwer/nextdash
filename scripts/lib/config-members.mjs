/**
 * Reading dashboard-config.js as a set of class members.
 *
 * Shared by the extractor and the section planner so the two cannot disagree
 * about where a method begins and ends — a disagreement there would mean the
 * planner blessing a move the extractor then performs differently.
 *
 * This is not a JavaScript parser and does not try to be. It needs three
 * things: where each member starts, where it ends, and which other members and
 * statics its body names. Brace counting answers the first two as long as it
 * knows what is code and what is not, which is what the scanner below is for.
 */
import { readFileSync } from 'node:fs';

export const CORE = 'static/js/dashboard/dashboard-config.js';

/*
 * A naive brace count is wrong on the first method it meets: `{` appears in
 * strings, in template literals (which nest, via `${}`), in regexes and in
 * comments. This walks one line and returns the depth change for the code parts
 * only, carrying state across lines because block comments and template
 * literals both span them.
 *
 * The one real ambiguity in JavaScript is `/`: divide, or the start of a regex?
 * It is settled the way every hand-written scanner settles it — by the last
 * meaningful character before it. After a value (identifier, number, closing
 * bracket) it divides; after an operator, comma or opening bracket it opens a
 * regex.
 */
export function makeScanner() {
    const state = { inBlockComment: false, templates: [], prev: '' };

    const opensRegex = (prev) => prev === '' || '=(,:[!&|?+-*%~^<>;{}'.includes(prev);

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

            const top = state.templates.at(-1);
            if (top && top.inText) {
                if (c === '\\') { i += 2; continue; }
                if (c === '`') { state.templates.pop(); i += 1; continue; }
                if (c === '$' && next === '{') { top.inText = false; top.braces = 0; i += 2; continue; }
                i += 1;
                continue;
            }

            if (c === '/' && next === '/') break;
            if (c === '/' && next === '*') { state.inBlockComment = true; i += 2; continue; }

            if (c === '"' || c === "'") {
                i += 1;
                while (i < n) {
                    if (line[i] === '\\') { i += 2; continue; }
                    if (line[i] === c) { i += 1; break; }
                    i += 1;
                }
                state.prev = 'x';
                continue;
            }

            if (c === '`') { state.templates.push({ inText: true, braces: 0 }); i += 1; continue; }

            if (c === '/' && opensRegex(state.prev)) {
                i += 1;
                let inClass = false;
                while (i < n) {
                    if (line[i] === '\\') { i += 2; continue; }
                    if (line[i] === '[') inClass = true;
                    else if (line[i] === ']') inClass = false;
                    else if (line[i] === '/' && !inClass) { i += 1; break; }
                    i += 1;
                }
                while (i < n && /[a-z]/.test(line[i])) i += 1;
                state.prev = 'x';
                continue;
            }

            if (c === '{') {
                if (top && !top.inText) top.braces += 1;
                else depth += 1;
            } else if (c === '}') {
                if (top && !top.inText) {
                    if (top.braces === 0) top.inText = true;
                    else top.braces -= 1;
                } else depth -= 1;
            }

            if (!/\s/.test(c)) state.prev = c;
            i += 1;
        }
        return depth;
    };
}

/** A declaration line, at the class body's four-space indent. */
const DECL = /^ {4}(?:(static)\s+)?(?:(async)\s+)?(?:(get|set)\s+)?\*?([A-Za-z_]\w*)\s*([(=])/;

/*
 * Words that look exactly like a method declaration at four spaces once a
 * module wrapper puts a statement there. Named rather than guessed at.
 */
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else',
    'try', 'return', 'function', 'with', 'Object', 'global', 'window']);

/** The comment block directly above a member belongs to it. */
function commentStartAbove(lines, at) {
    let start = at;
    let i = at - 1;
    while (i >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[i])) { start = i; i -= 1; }
    return start;
}

/**
 * Every member of the class, with its line range and what its body names.
 *
 * `calls` holds the `this.x(` names in the body and `reads` the
 * `DashboardConfig.X` statics, which is everything the planner needs to work
 * out whether a member can leave without stranding one of its callers.
 */
export function indexMembers(file = CORE) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const members = [];
    const byName = new Map();

    for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(DECL);
        if (!m) continue;
        const [, isStatic, , accessor, name, opener] = m;
        if (KEYWORDS.has(name)) continue;
        // `static X = …` is a field; `name(` is a method. Anything else at this
        // indent that is not one of those is not a member.
        if (opener === '=' && !isStatic) continue;

        const scanLine = makeScanner();
        let depth = 0;
        let seenBrace = false;
        let end = -1;
        for (let j = i; j < lines.length; j += 1) {
            const before = depth;
            depth += scanLine(lines[j]);
            if (depth > 0 || (before > 0 && depth === 0)) seenBrace = true;
            if (seenBrace && depth === 0) { end = j; break; }
            if (!seenBrace && depth === 0 && /;\s*(\/\/.*)?$/.test(lines[j])) { end = j; break; }
        }
        if (end < 0) continue;

        const body = lines.slice(i, end + 1).join('\n');
        const member = {
            name,
            kind: accessor ? `${accessor}:${name}` : name,
            isStatic: Boolean(isStatic),
            isAccessor: Boolean(accessor),
            declLine: i,
            start: commentStartAbove(lines, i),
            end,
            lineCount: end - i + 1,
            /*
             * `this.x(` and `this.x?.(` both. The optional form is the shape the
             * codebase already uses where a method may not have arrived yet —
             * `this.helpTabLabel?.(tab) || tab` — so missing it would hide
             * exactly the call sites this analysis exists to find. They do not
             * throw when the method is absent, but they do quietly return the
             * fallback, which is a wrong label rather than a crash.
             */
            calls: new Set([...body.matchAll(/this\.([A-Za-z_]\w*)\s*\??\.?\s*\(/g)].map((x) => x[1])),
            reads: new Set([...body.matchAll(/DashboardConfig\.([A-Z][A-Z0-9_]*)\b/g)].map((x) => x[1])),
        };
        members.push(member);
        // A name defined twice is a real hazard for a move; keep both so the
        // caller can complain about it rather than silently taking the first.
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(member);
        i = end;
    }

    return { lines, members, byName };
}

/** Which member a given line sits inside, or null for class-level lines. */
export function memberAt(members, line) {
    return members.find((m) => line >= m.declLine && line <= m.end) || null;
}
