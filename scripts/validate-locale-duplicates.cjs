#!/usr/bin/env node
'use strict';

/**
 * A key written twice in the same locale object.
 *
 * JSON parsers keep the last one and say nothing, so the earlier line is a
 * string that looks live, greps like it is live, and can never render. Two
 * delay labels were added this way and were only found when the setting drew
 * wording nobody had written that day; `bookmarksLoading` and
 * `bookmarksKeysHint` had been duplicated in all four locales for longer.
 *
 * JSON.parse cannot report this, so the file is walked with a reviver that sees
 * the raw pairs. Exit code 1 on any duplicate: unlike a missing translation,
 * there is no case where this is intended.
 */

const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'locales');
const files = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json'));

let failed = false;

for (const file of files) {
    const duplicates = [];
    const raw = fs.readFileSync(path.join(LOCALES, file), 'utf8');
    // Parsed first so a malformed file fails here with a JSON error rather
    // than as a confusing duplicate report from the scan below.
    JSON.parse(raw);

    // Walk the text, tracking object depth and the key each object was opened
    // under, so keys are compared within their own object and nowhere else —
    // and a hit is reported by its path (`config.linkPreviewDelayFast`) rather
    // than a bare name that legitimately appears in several sections.
    let depth = 0;
    const stacks = [new Map()];
    const names = [];
    let i = 0;
    let lastKey = null;
    while (i < raw.length) {
        const ch = raw[i];
        if (ch === '"') {
            let j = i + 1;
            let text = '';
            while (j < raw.length) {
                if (raw[j] === '\\') { text += raw[j] + raw[j + 1]; j += 2; continue; }
                if (raw[j] === '"') break;
                text += raw[j];
                j += 1;
            }
            // A string is a key only when a colon follows it.
            let k = j + 1;
            while (k < raw.length && /\s/.test(raw[k])) k += 1;
            if (raw[k] === ':') {
                const scope = stacks[depth];
                const line = raw.slice(0, i).split('\n').length;
                if (scope.has(text)) {
                    const where = [...names, text].filter(Boolean).join('.');
                    duplicates.push(`${where} (lines ${scope.get(text)} and ${line})`);
                } else {
                    scope.set(text, line);
                }
                lastKey = text;
            }
            i = j + 1;
            continue;
        }
        if (ch === '{') {
            depth += 1;
            stacks[depth] = new Map();
            names.push(lastKey ?? '');
            lastKey = null;
        } else if (ch === '}') {
            stacks.length = depth;
            depth -= 1;
            names.pop();
        }
        i += 1;
    }

    if (duplicates.length) {
        failed = true;
        console.error(`  ✗ ${file}: ${duplicates.length} duplicate key(s) — ${duplicates.slice(0, 8).join('; ')}${duplicates.length > 8 ? '; …' : ''}`);
    } else {
        console.log(`  ok ${file}: no duplicate keys`);
    }
}

if (failed) {
    console.error('A duplicate key means the earlier line can never render.');
    process.exit(1);
}
console.log('No duplicate locale keys.');
