#!/usr/bin/env node
'use strict';

/**
 * The Unraid template in this repo, against the one Community Applications reads.
 *
 * CA does not read `templates/nextdash.xml` — it reads the copy in the
 * jordibrouwer/unraid_templates repository, named by the template's own
 * `<TemplateURL>`. The two drifted apart for four releases without anything
 * saying so: this copy grew the host widget rows while the live one grew the
 * release notes and a better feature list, and every Unraid install saw the
 * live one.
 *
 * So the check is simply whether they are the same file. It reaches the
 * network, which is why it is not part of `npm run validate:json` and not in
 * CI: raw.githubusercontent.com serves a cached copy for a few minutes after a
 * push, so a run right after publishing reports a difference that is already
 * fixed. Run it when the template changes, or before a release.
 *
 * Exit 1 when the files differ or the live one cannot be read.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const localPath = path.join(root, 'templates', 'nextdash.xml');
const local = fs.readFileSync(localPath, 'utf8');

// The address is the template's own, so a move of the live copy is picked up
// here rather than leaving this pointed at a file nobody publishes any more.
const url = (local.match(/<TemplateURL>([^<]+)<\/TemplateURL>/) || [])[1];
if (!url) {
    console.error('FAIL templates/nextdash.xml names no <TemplateURL>, so there is nothing to compare against.');
    process.exit(1);
}

async function main() {
    let live;
    try {
        const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
        if (!res.ok) {
            console.error(`FAIL ${url} answered ${res.status}.`);
            process.exit(1);
        }
        live = await res.text();
    } catch (error) {
        console.error(`FAIL could not read ${url}: ${error.message}`);
        process.exit(1);
    }

    if (live === local) {
        console.log(`ok templates/nextdash.xml is the file Community Applications reads (${local.length} characters).`);
        return;
    }

    const a = local.split('\n');
    const b = live.split('\n');
    const differing = [];
    for (let i = 0; i < Math.max(a.length, b.length) && differing.length < 10; i += 1) {
        if (a[i] !== b[i]) differing.push(`  line ${i + 1}\n    here: ${a[i] ?? '(none)'}\n    live: ${b[i] ?? '(none)'}`);
    }
    console.error(`FAIL templates/nextdash.xml differs from ${url}`);
    console.error(`  here: ${local.length} characters, live: ${live.length}`);
    console.error(differing.join('\n'));
    console.error('\nPublish the same file to jordibrouwer/unraid_templates, or pull its version in here.');
    console.error('A push takes a few minutes to reach the raw CDN; if you just published, run this again.');
    process.exit(1);
}

main();
