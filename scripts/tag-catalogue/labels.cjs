#!/usr/bin/env node
'use strict';

/**
 * English labels for Wikidata ids, cached in cache/labels.json. Reads a JSON
 * list of [qid, weight] pairs on stdin (classify.cjs --classes) and prints
 * "weight qid label" lines, so the QID table can be written by reading.
 */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'cache', 'labels.json');
const labels = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

async function main() {
    const pairs = JSON.parse(fs.readFileSync(0, 'utf8'));
    const missing = pairs.map(([q]) => q).filter((q) => !(q in labels));
    for (let i = 0; i < missing.length; i += 50) {
        const ids = missing.slice(i, i + 50).join('|');
        const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels&languages=en&format=json`;
        const data = await (await fetch(url, { headers: { 'User-Agent': 'nextDash-catalogue-build/1.0' } })).json();
        Object.entries(data.entities || {}).forEach(([q, entity]) => {
            labels[q] = entity.labels?.en?.value || '';
        });
    }
    fs.writeFileSync(file, JSON.stringify(labels));
    pairs.forEach(([q, weight]) => console.log(`${weight}\t${q}\t${labels[q] || ''}`));
}

main();
