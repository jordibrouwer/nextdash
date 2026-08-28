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

const root = path.join(__dirname, '..');
const FILES = ['README.md', 'MANUAL.md'];

/*
 * GitHub's rule, which is not the obvious one.
 *
 * Non-word characters are *removed*, not replaced: "Config — complete
 * walkthrough" becomes `config-complete-walkthrough`, with one hyphen where the
 * dash was and not the two a replace-with-hyphen rule produces. Every broken
 * link this script was written for came from getting that backwards.
 */
function slug(heading) {
    const text = heading.replace(/^#+/, '').trim().toLowerCase();
    return text.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}

/* The anchors a file offers, and the line each heading sits on. */
function headingsOf(source) {
    const anchors = new Map();
    source.split('\n').forEach((line, index) => {
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

if (broken) {
    console.error(`\n${broken} of ${checked} links point at a heading that is not there.`);
    console.error('A reader clicking one lands at the top of the file, none the wiser.');
    process.exit(1);
}
console.log(`ok  ${checked} links across ${FILES.join(', ')} all resolve`);
