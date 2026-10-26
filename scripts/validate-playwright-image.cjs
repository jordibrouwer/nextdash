#!/usr/bin/env node
'use strict';

/**
 * The e2e job runs in Microsoft's Playwright image, whose tag carries the
 * Playwright version the browsers inside it were built for. A package-lock
 * that moves to another version leaves the image with the wrong browsers, and
 * the shards then fail with "Executable doesn't exist" rather than with a
 * message about the version. This says so at once, in the validate job.
 *
 * Exit 1 when the tag in .github/workflows/ci.yml is not the version of
 * @playwright/test that package-lock.json installs.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const installed = lock.packages?.['node_modules/@playwright/test']?.version;
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const tag = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)/.exec(workflow)?.[1];

if (!installed) {
    console.error('package-lock.json has no @playwright/test');
    process.exit(1);
}
if (!tag) {
    console.error('ci.yml names no mcr.microsoft.com/playwright:v<version> image');
    process.exit(1);
}
if (installed !== tag) {
    console.error(`ci.yml runs the e2e job in the Playwright ${tag} image, but package-lock.json installs @playwright/test ${installed}.`);
    console.error(`Change the image tag to v${installed}-noble.`);
    process.exit(1);
}
console.log(`ok  the Playwright image (v${tag}) matches @playwright/test ${installed}`);
