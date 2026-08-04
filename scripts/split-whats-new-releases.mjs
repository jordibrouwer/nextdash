#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(root, 'static/data/whats-new-releases.json');
const outDir = path.join(root, 'static/data/whats-new');

const releases = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
if (!Array.isArray(releases)) {
    throw new Error('expected array in whats-new-releases.json');
}

fs.mkdirSync(outDir, { recursive: true });

const manifest = releases.map((entry) => {
    const id = entry.tag;
    const filePath = path.join(outDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    return {
        id,
        tag: entry.tag,
        date: entry.date,
        releasedAt: entry.releasedAt,
    };
});

manifest.sort((a, b) => {
    const dateDiff = Date.parse(`${b.releasedAt}T12:00:00Z`) - Date.parse(`${a.releasedAt}T12:00:00Z`);
    if (dateDiff !== 0) {
        return dateDiff;
    }
    return b.tag.localeCompare(a.tag, undefined, { numeric: true });
});

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifest.length} releases to ${outDir}/`);
