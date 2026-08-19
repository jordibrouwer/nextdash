#!/usr/bin/env node
'use strict';

/**
 * Help's strings, checked across the four languages.
 *
 * The cheat sheet has had this check for a while and Help never did, so a new
 * help panel could ship with English text in three of the four locales and
 * nothing would say so — the fallback is the English wording, which renders
 * perfectly and reads as a translation nobody got round to.
 *
 * Three questions, in the order they cost a reader:
 *   1. Is a key English has missing somewhere else? That panel renders its
 *      fallback, or nothing at all where the fallback is ''.
 *   2. Is a body byte-identical to English? Either untranslated, or genuinely
 *      the same sentence — proper nouns and code keep some strings identical,
 *      so short ones are ignored and the rest are listed rather than failed.
 *   3. Is a key carried in the other locales that English has dropped? That is
 *      dead weight travelling in every translation payload.
 *
 * Exit code 1 for a missing key. Identical prose is reported, never fatal:
 * failing on it would make an accurate translation impossible to ship.
 */

const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'locales');
const LANGS = ['nl', 'de', 'fr'];
const BASE = 'en';
/** Below this, an identical string is usually a key name, a shortcut or a product name. */
const SAME_TEXT_MIN = 60;

function config(lang) {
    const raw = fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8');
    return JSON.parse(raw).config || {};
}

function helpKeys(section) {
    return Object.keys(section).filter((k) => (k.startsWith('help') || k.startsWith('tip'))
        && typeof section[k] === 'string');
}

const base = config(BASE);
const baseKeys = helpKeys(base);

let failed = false;
const notes = [];

for (const lang of LANGS) {
    const section = config(lang);
    const missing = baseKeys.filter((k) => typeof section[k] !== 'string');
    const extra = helpKeys(section).filter((k) => typeof base[k] !== 'string');
    const same = baseKeys.filter((k) => typeof section[k] === 'string'
        && section[k] === base[k]
        && base[k].length >= SAME_TEXT_MIN);

    if (missing.length) {
        failed = true;
        console.error(`  ✗ ${lang}: ${missing.length} help strings missing — ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`);
    } else {
        console.log(`  ok ${lang}: all ${baseKeys.length} help strings present`);
    }
    if (extra.length) {
        notes.push(`  · ${lang}: ${extra.length} help strings English no longer has — ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ', …' : ''}`);
    }
    if (same.length) {
        notes.push(`  · ${lang}: ${same.length} long help strings identical to English — ${same.slice(0, 6).join(', ')}${same.length > 6 ? ', …' : ''}`);
    }
}

notes.forEach((n) => console.log(n));

if (failed) {
    console.error('Help translations are incomplete.');
    process.exit(1);
}
console.log('Help translations are complete.');
