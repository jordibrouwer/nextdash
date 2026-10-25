#!/usr/bin/env node
'use strict';

/*
 * Every screenshot MANUAL.md points at exists, and every file in
 * screenshots/manual.md/ is pointed at (the directory is called that,
 * literally). Run after a shot run, before committing the pictures:
 *
 *   node scripts/validate-manual-shot-refs.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manual = fs.readFileSync(path.join(root, 'MANUAL.md'), 'utf8');
const dir = path.join(root, 'screenshots', 'manual.md');
const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
const refs = new Set([...manual.matchAll(/screenshots\/manual\.md\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]));

const missing = [...refs].filter((r) => !files.includes(r)).sort();
const unreferenced = files.filter((f) => !refs.has(f)).sort();

console.log(`${files.length} files, ${refs.size} referenced`);
if (missing.length) console.error(`missing: ${missing.join(', ')}`);
if (unreferenced.length) console.error(`unreferenced: ${unreferenced.join(', ')}`);
process.exit(missing.length || unreferenced.length ? 1 : 0);
