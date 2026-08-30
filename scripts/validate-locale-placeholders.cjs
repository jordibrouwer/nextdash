#!/usr/bin/env node
'use strict';

/**
 * A translated string has to carry the same substitution tokens as its English
 * original, because the code that fills them in does not know it is translating.
 *
 * The call sites are literal replaces — `.replace('{i}', String(imported))` — so
 * a translation that drops the token does not fail, does not warn, and does not
 * fall back. It renders a sentence with the numbers quietly missing. That is
 * exactly what `config.browserImportDone` did in Dutch, German and French: the
 * English confirmation read "Imported 34, skipped 8 duplicates" and all three
 * translations read "browser bookmarks imported", full stop, for as long as the
 * key had existed. Nothing on either side of the fence could see it — the parity
 * validator only asks whether a key exists, and a reader in one language never
 * sees another language's wording.
 *
 * Three token shapes are in use and all three are checked:
 *
 *   {name}     the common one, filled by a literal replace or extension/i18n.js
 *   {{name}}   config-favicon-prefetch.js, which replaces the doubled form
 *   %s         not filled in by anything — it is the literal the reader must
 *              type into a finder's search URL. The finders tour is *about* that
 *              literal, so a translation that drops it deletes the instruction.
 *
 * Inline HTML is deliberately NOT compared. The `config.help*` bodies are
 * manual-length prose where a translator may reasonably wrap one more phrase in
 * <code> or one fewer in <em>; measured across nl, de and fr there are around
 * thirteen such differences and every one of them is a judgement call, not a
 * defect. Counting tags would bury the signal this script exists for.
 *
 * Usage: node scripts/validate-locale-placeholders.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['locales', 'extension/locales'];
const BASE = 'en';

// The doubled form has to be consumed first: against "{{count}} bookmarks" a
// lone /\{\w+\}/ matches the inner "{count}" and reports a difference that is
// not there.
const TOKEN = /\{\{\w+\}\}|\{\w+\}|%s/g;

/** The substitution tokens in one string, order-insensitive but count-sensitive. */
function tokensIn(value) {
    return (String(value).match(TOKEN) || []).sort();
}

/** Every string in a locale file, keyed by dotted path, whatever the nesting. */
function flatten(node, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(node)) {
        const dotted = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            out[dotted] = value;
        } else if (value && typeof value === 'object') {
            flatten(value, dotted, out);
        }
    }
    return out;
}

const read = (dir, lang) =>
    flatten(JSON.parse(fs.readFileSync(path.join(ROOT, dir, `${lang}.json`), 'utf8')));

/** Sibling languages of en.json in a directory, so a new locale is covered by existing. */
function languagesIn(dir) {
    return fs.readdirSync(path.join(ROOT, dir))
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.basename(file, '.json'))
        .filter((lang) => lang !== BASE)
        .sort();
}

let failed = false;

for (const dir of DIRS) {
    const base = read(dir, BASE);
    for (const lang of languagesIn(dir)) {
        const other = read(dir, lang);
        const problems = [];
        for (const [key, english] of Object.entries(base)) {
            // A key missing here is the parity validator's report to make, not this one's.
            if (!(key in other)) continue;
            const want = tokensIn(english);
            const got = tokensIn(other[key]);
            if (want.join(' ') !== got.join(' ')) {
                problems.push(`${key}: en has [${want.join(' ')}], ${lang} has [${got.join(' ')}]`);
            }
        }
        if (problems.length) {
            failed = true;
            console.error(`  ✗ ${dir}/${lang}.json`);
            for (const problem of problems) console.error(`      ${problem}`);
        } else {
            console.log(`  ok ${dir}/${lang}.json: same tokens as ${BASE}`);
        }
    }
}

if (failed) {
    console.error('A translation drops or invents a substitution token, which renders as a gap at runtime.');
    process.exit(1);
}
console.log('Every translation carries the same substitution tokens as English.');
