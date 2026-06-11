#!/usr/bin/env node
/**
 * Regenerate per-release JSON from whats-new-modal.js (legacy monolith) OR
 * refresh index order from static/data/whats-new/*.json
 *
 * Usage: node scripts/extract-whats-new-json.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'static/data/whats-new');
const monolithPath = path.join(root, 'static/data/whats-new-releases.json');

function writePerRelease(releases) {
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = releases.map((entry) => {
        const id = entry.tag;
        fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(entry, null, 2));
        return { id, tag: entry.tag, date: entry.date, releasedAt: entry.releasedAt };
    });
    manifest.sort((a, b) => Date.parse(`${b.releasedAt}T12:00:00Z`) - Date.parse(`${a.releasedAt}T12:00:00Z`));
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${manifest.length} releases to ${outDir}/`);
}

if (fs.existsSync(monolithPath)) {
    writePerRelease(JSON.parse(fs.readFileSync(monolithPath, 'utf8')));
} else {
    const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    const releases = files.map((f) => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')));
    writePerRelease(releases);
}
