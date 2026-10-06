#!/usr/bin/env node
'use strict';

/**
 * Every link between the documents, resolved.
 *
 * Markdown anchors break silently. Nothing warns you, nothing renders red — a
 * reader clicks and lands at the top of a 2,700-line file wondering what they
 * missed. Four links inside MANUAL.md were broken for months before a
 * restructure went looking, and all four had the same cause: whoever wrote them
 * assumed GitHub turns an em dash or a bracket into a hyphen, when it removes
 * the character and leaves the words either side joined by one.
 *
 * The other way in is a heading that carries a version tag. `#### Fresh: what
 * changed since you looked (v1.3.0)` slugs to `…-you-looked-v130`, so a link
 * written before the tag was added, or kept after it changed, points at
 * nothing. Renaming any heading does the same to every link into it.
 *
 * So this resolves all four directions — README to MANUAL, MANUAL to README,
 * and each file's links into itself — using GitHub's own slug rule rather than
 * an approximation of it.
 */

const fs = require('fs');
const path = require('path');

const root = process.env.DOC_LINKS_ROOT || path.join(__dirname, '..');
const FILES = ['README.md', 'MANUAL.md'];

/*
 * GitHub's rule (github-slugger), checked against every heading GitHub
 * renders for MANUAL.md.
 *
 * Everything but letters, marks, numbers, connector punctuation, spaces and
 * hyphens is removed, and then *each* space becomes a hyphen -- no collapsing.
 * So "## 3. 🧩 Core concepts" is `3--core-concepts` (the emoji goes, its two
 * spaces stay), "Checks & health" is `checks--health`, and the invisible
 * variation selector after some emoji (⚙️) is a mark and stays in the slug.
 * The earlier version collapsed runs of spaces, which agreed with itself and
 * with no page GitHub ever drew: every emoji heading's link was broken there.
 */
function slug(heading) {
    const text = heading.replace(/^#+/, '').trim().toLowerCase();
    return text.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

/* The anchors a file offers, and the line each heading sits on. */
function headingsOf(source) {
    const anchors = new Map();
    source.split('\n').forEach((line, index) => {
        // An explicit anchor: an ASCII id beside an emoji heading, so the
        // table of contents works in viewers whose slug rule is not GitHub's.
        const explicit = line.match(/^<a id="([^"]+)"><\/a>$/);
        if (explicit && !anchors.has(explicit[1])) anchors.set(explicit[1], index + 1);
        if (!line.startsWith('#')) return;
        const anchor = slug(line);
        // First heading wins, which is what GitHub does before it starts
        // appending -1, -2 to duplicates. A link to a repeated heading is
        // ambiguous anyway and worth writing differently.
        if (anchor && !anchors.has(anchor)) anchors.set(anchor, index + 1);
    });
    return anchors;
}

/*
 * Where a link points, and from which line.
 *
 * Two shapes: `](#anchor)` stays inside the file, `](OTHER.md#anchor)` crosses
 * into the other one. Both are collected with their line number, because "a
 * link is broken" is not useful without saying where to go and fix it.
 */
function linksOf(source, ownFile) {
    const found = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/\]\((?:([\w.-]+\.md))?#([^)\s]+)\)/g)) {
            found.push({ file: match[1] || ownFile, anchor: match[2], line: index + 1 });
        }
        for (const match of line.matchAll(/href="(?:([\w.-]+\.md))?#([^"\s]+)"/g)) {
            found.push({ file: match[1] || ownFile, anchor: match[2], line: index + 1 });
        }
    });
    return found;
}

const sources = new Map();
const anchors = new Map();
for (const file of FILES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    sources.set(file, source);
    anchors.set(file, headingsOf(source));
}

let broken = 0;
let checked = 0;

for (const from of FILES) {
    for (const link of linksOf(sources.get(from), from)) {
        // A link to a file this script does not read — an image, another
        // repository's markdown — is somebody else's business.
        if (!anchors.has(link.file)) continue;
        checked += 1;
        if (anchors.get(link.file).has(link.anchor)) continue;

        broken += 1;
        console.error(`  ✗ ${from}:${link.line} → ${link.file}#${link.anchor}`);

        /*
         * Say what it probably meant. Almost every break is a near miss — a
         * doubled hyphen, or a version tag on the end of the heading — and
         * naming the live anchor turns a report into a fix.
         */
        const near = [...anchors.get(link.file).keys()].find((candidate) => (
            candidate.replace(/-+/g, '-') === link.anchor.replace(/-+/g, '-')
            || candidate.startsWith(`${link.anchor}-v`)
            || link.anchor.startsWith(`${candidate}-v`)
        ));
        if (near) console.error(`      did you mean #${near}?`);
    }
}

/*
 * The manual's pictures and folds. An image that is not there renders as a
 * broken icon; a <details> left open swallows the rest of the chapter; and
 * GitHub only renders Markdown inside a fold when a blank line follows
 * </summary>. A screenshot nobody links is dead weight on main.
 */
const SHOT_DIR = 'screenshots/manual.md';
const referenced = new Set();
for (const file of FILES) {
    const lines = sources.get(file).split('\n');
    const ids = new Map();
    let open = 0;
    lines.forEach((line, index) => {
        for (const match of line.matchAll(/(?:src="|!\[[^\]]*\]\()([^")\s]+\.(?:jpg|jpeg|png|gif|svg|webp))/gi)) {
            const target = match[1].split('?')[0];
            if (/^https?:/.test(target)) continue;
            referenced.add(path.normalize(target));
            if (!fs.existsSync(path.join(root, target))) {
                broken += 1;
                console.error(`  ✗ ${file}:${index + 1} → image ${target} does not exist`);
            }
        }
        const id = line.match(/^<a id="([^"]+)"><\/a>$/);
        if (id) {
            if (ids.has(id[1])) {
                broken += 1;
                console.error(`  ✗ ${file}:${index + 1} → anchor #${id[1]} also on line ${ids.get(id[1])}`);
            } else ids.set(id[1], index + 1);
        }
        open += (line.match(/<details\b/g) || []).length;
        open -= (line.match(/<\/details>/g) || []).length;
        // GitHub renders Markdown after </summary> only if there is a blank line.
        // HTML tags right after summary (like <br />) need no blank line, so allow those.
        if (line.includes('</summary>') && (lines[index + 1] ?? '').trim() !== '' && !(lines[index + 1] ?? '').trim().startsWith('<')) {
            broken += 1;
            console.error(`  ✗ ${file}:${index + 1} → blank line needed after </summary>`);
        }
    });
    if (open !== 0) {
        broken += 1;
        console.error(`  ✗ ${file} → ${open > 0 ? open + ' <details> never closed' : -open + ' </details> too many'}`);
    }
}
const shotDir = path.join(root, SHOT_DIR);
if (fs.existsSync(shotDir)) {
    for (const name of fs.readdirSync(shotDir)) {
        if (!referenced.has(path.normalize(`${SHOT_DIR}/${name}`))) {
            broken += 1;
            console.error(`  ✗ ${SHOT_DIR}/${name} is not used in ${FILES.join(' or ')}`);
        }
    }
}

if (broken) {
    console.error(`\n${broken} problem(s) in the documents.`);
    process.exit(1);
}
console.log(`ok  ${checked} links across ${FILES.join(', ')} all resolve`);
