#!/usr/bin/env node
'use strict';

/**
 * Every key the code asks for with a fallback has to exist in English.
 *
 * A call such as t('dashboard.glancesInsDay', 'A typical day') works without
 * the key: the fallback is shown. It is also shown in Dutch, German, French,
 * Spanish and Chinese, because the key that would carry their words was never
 * made. locale-parity cannot see it (the key is in none of the files), and
 * locale-unused looks the other way round. This is the third direction: from
 * the code to en.json.
 *
 * Only literal pairs are read: a quoted "section.name" followed by a quoted
 * fallback. A key built at run time (`dashboard.x_${id}`) is left alone.
 *
 * Two things are not keys: a name that other keys start with (the look
 * settings pass `config.themeDepth` and the code adds `Flat`, `Soft`...), and
 * anything inside a comment, where an example may use a made-up key.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8'));
const sections = Object.keys(en).filter((s) => en[s] && typeof en[s] === 'object');
const pair = new RegExp(
    `['"\`]((?:${sections.join('|')})\\.[A-Za-z0-9_]+)['"\`]\\s*,\\s*(?:'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`(?:[^\`\\\\]|\\\\.)*\`)`,
    'g'
);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const missing = new Map();
for (const file of walk(path.join(ROOT, 'static', 'js'))) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    let m;
    while ((m = pair.exec(text))) {
        const [section, name] = [m[1].slice(0, m[1].indexOf('.')), m[1].slice(m[1].indexOf('.') + 1)];
        if (en[section] && (name in en[section] || Object.keys(en[section]).some((k) => k.startsWith(name)))) continue;
        const where = missing.get(m[1]) || [];
        where.push(path.relative(ROOT, file));
        missing.set(m[1], where);
    }
}

if (missing.size) {
    console.error(`  ✗ ${missing.size} key(s) are asked for with a fallback and are not in locales/en.json:`);
    for (const [key, files] of [...missing].sort()) console.error(`      ${key}  (${[...new Set(files)].join(', ')})`);
    console.error('Add them to en.json and translate them, or the fallback shows in every language.');
    process.exit(1);
}
console.log('  ok every key asked for with a fallback is in locales/en.json');
