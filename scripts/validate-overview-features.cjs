#!/usr/bin/env node
'use strict';

/**
 * The overview's feature catalogue, checked.
 *
 * Two things go wrong here and neither shows up in the browser. A feature with
 * a locale key nobody wrote renders its English fallback, which reads like a
 * translation nobody got round to. And a feature with no `since` cannot take
 * its place in the news stream — it sorts to the bottom with the back
 * catalogue, which is right for the forty-two that were imported in one go and
 * wrong for anything added since.
 *
 * Exit 1 on a broken entry; the undated back catalogue is reported, never
 * fatal — dating it after the fact would be guessing.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'static', 'data', 'overview-features.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'en.json'), 'utf8')).config || {};
const releases = new Set(
    JSON.parse(fs.readFileSync(path.join(root, 'static', 'data', 'whats-new', 'index.json'), 'utf8'))
        .map((entry) => entry.tag),
);

const KEYS = ['titleKey', 'whatKey', 'howKey', 'enableKey', 'ctaKey'];
const FALLBACKS = ['titleFallback', 'whatFallback', 'howFallback', 'enableFallback', 'ctaFallback'];

let failed = false;
const undated = [];

(doc.features || []).forEach((feature, i) => {
    const name = feature.titleKey || `#${i}`;
    const problems = [];

    for (const key of KEYS) {
        const value = feature[key];
        if (typeof value !== 'string' || !value.startsWith('config.')) {
            problems.push(`${key} is not a config.* key`);
            continue;
        }
        if (typeof en[value.slice('config.'.length)] !== 'string') {
            problems.push(`${value} is missing from locales/en.json`);
        }
    }
    for (const key of FALLBACKS) {
        if (typeof feature[key] !== 'string' || !feature[key].trim()) {
            problems.push(`${key} is empty — the fallback is what shows when a locale lags`);
        }
    }
    if (!feature.go || typeof feature.go !== 'object') {
        problems.push('go is missing — the button would lead nowhere');
    }
    if (feature.since === undefined) {
        undated.push(name);
    } else if (!releases.has(feature.since)) {
        problems.push(`since ${feature.since} is not a release in whats-new/index.json`);
    }

    if (problems.length) {
        failed = true;
        console.error(`  ✗ ${name}: ${problems.join('; ')}`);
    }
});

if (undated.length) {
    console.log(`  · ${undated.length} features carry no "since" — the back catalogue, imported in one go.`);
    console.log('    They sort below the dated ones in the news stream, which is where they belong.');
}
if (failed) {
    console.error('Overview features are broken.');
    process.exit(1);
}
console.log(`ok  ${doc.features.length} overview features, ${doc.features.length - undated.length} dated`);
