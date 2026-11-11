#!/usr/bin/env node
// Writes static/data/licenses.json, the list the About page shows under
// "Credits and licences": nextDash itself and the Go modules, the vendored
// browser libraries, and the icon sets. Run it after go.mod/go.sum or
// static/vendor change; scripts/release-preflight.sh fails when it is stale.
//
// Usage: node scripts/gen-licenses.mjs   (from anywhere)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'static', 'data', 'licenses.json');
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Distinctive phrases, most specific first.
function detectLicense(text) {
    const t = text.replace(/\s+/g, ' ');
    if (/Apache License,? Version 2\.0/i.test(t)) return 'Apache-2.0';
    if (/Mozilla Public License,? (Version |v\. ?)2\.0/i.test(t)) return 'MPL-2.0';
    if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
    if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(t)) return 'ISC';
    if (/Redistribution and use in source and binary forms/i.test(t)) {
        if (/Neither the name of/i.test(t) || /endorse or promote/i.test(t)) return 'BSD-3-Clause';
        return 'BSD-2-Clause';
    }
    return 'Unknown';
}

function readLicenseIn(dir) {
    if (!dir || !existsSync(dir)) return 'Unknown';
    try {
        const file = readdirSync(dir).find((f) => /^(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i.test(f));
        return file ? detectLicense(readFileSync(join(dir, file), 'utf8')) : 'Unknown';
    } catch {
        return 'Unknown';
    }
}

function listModules() {
    const raw = execFileSync('go', ['list', '-m', '-json', 'all'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // `go list -m -json` prints concatenated JSON objects.
    const mods = [];
    for (const chunk of raw.split(/\n(?=\{)/)) {
        try { mods.push(JSON.parse(chunk)); } catch { /* skip */ }
    }
    // Only modules that end up in the binary; the rest of the module graph is
    // go.mod bookkeeping and is never downloaded.
    let used = null;
    try {
        used = new Set(execFileSync('go', ['list', '-deps', '-f', '{{with .Module}}{{.Path}}{{end}}', './...'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean));
    } catch { /* keep the whole graph */ }
    return mods.filter((m) => !m.Main && (!used || used.has(m.Path)));
}

function goModules() {
    let mods = [];
    try {
        mods = listModules();
        // A module that is not in the cache has no Dir; fetch once and look again.
        if (mods.some((m) => !m.Dir)) {
            try {
                execFileSync('go', ['mod', 'download'], { cwd: ROOT, stdio: 'ignore' });
                mods = listModules();
            } catch { /* offline: those stay Unknown */ }
        }
    } catch (e) {
        console.error(`gen-licenses: could not list the Go modules (${e.message.split('\n')[0]}); not touching the file.`);
        process.exit(1);
    }
    return mods
        .map((m) => ({
            name: m.Path,
            version: m.Version || '',
            license: readLicenseIn(m.Dir),
            url: `https://pkg.go.dev/${m.Path}@${m.Version}`,
        }))
        .sort(byName);
}

// Upstream homes for the vendored libraries.
const VENDOR_URLS = {
    'qrcode-generator': 'https://github.com/kazuhikoarase/qrcode-generator',
    uplot: 'https://github.com/leeoniya/uPlot',
};
// Display names where the directory name is not the library's own spelling.
const VENDOR_NAMES = {
    'qrcode-generator': 'QRCode Generator',
    uplot: 'uPlot',
};

function vendorLibs() {
    const base = join(ROOT, 'static', 'vendor');
    const items = [];
    if (!existsSync(base)) return items;
    for (const lib of readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const versions = readdirSync(join(base, lib.name), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
        const version = versions[versions.length - 1] || '';
        const dir = version ? join(base, lib.name, version) : join(base, lib.name);
        items.push({
            name: VENDOR_NAMES[lib.name] || lib.name,
            version,
            license: readLicenseIn(dir),
            url: VENDOR_URLS[lib.name] || '',
        });
    }
    return items.sort(byName);
}

const nextdash = {
    name: 'nextDash',
    version: '',
    license: readLicenseIn(ROOT),
    url: 'https://github.com/jordibrouwer/nextDash',
};

// Matches renderIconCredits in dashboard-config.js.
const icons = [
    { name: 'dashboard-icons', version: '', license: 'Apache-2.0', url: 'https://github.com/homarr-labs/dashboard-icons' },
    { name: 'selfh.st/icons', version: '', license: 'CC BY 4.0', url: 'https://github.com/selfhst/icons' },
].sort(byName);

const out = {
    generatedAt: new Date().toISOString(),
    groups: [
        { name: 'Go modules', items: [nextdash, ...goModules()] },
        { name: 'Bundled in the browser', items: vendorLibs() },
        { name: 'Icons', items: icons },
    ],
};

let previous = null;
try { previous = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* no file yet */ }
const sameContent = previous && JSON.stringify(previous.groups) === JSON.stringify(out.groups);

if (process.argv.includes('--check')) {
    if (sameContent) {
        console.log('gen-licenses: static/data/licenses.json is up to date.');
        process.exit(0);
    }
    console.error('gen-licenses: static/data/licenses.json is out of date. Run node scripts/gen-licenses.mjs and commit it.');
    process.exit(1);
}

// Identical content keeps the old timestamp, so a rerun leaves no diff.
if (sameContent && previous.generatedAt) out.generatedAt = previous.generatedAt;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT} (${out.groups.map((g) => `${g.name}: ${g.items.length}`).join(', ')})`);
