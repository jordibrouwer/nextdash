'use strict';

/**
 * Write parents.json into a catalogue document as each subject's `parent`.
 *
 * Shared by merge.cjs (after a rebuild) and apply.cjs (in place). Refuses a
 * parent that is not a subject, and a chain that comes back on itself: the
 * engine stops at a cycle, but a cycle in the shipped file is a mistake.
 */

const fs = require('fs');
const path = require('path');

function applyParents(doc) {
    const { parents } = JSON.parse(fs.readFileSync(path.join(__dirname, 'parents.json'), 'utf8'));
    const subjects = new Set(doc.tags.map((entry) => entry.tag));
    Object.entries(parents).forEach(([tag, parent]) => {
        if (!subjects.has(tag)) throw new Error(`parents.json: unknown subject ${tag}`);
        if (!subjects.has(parent)) throw new Error(`parents.json: ${tag} has unknown parent ${parent}`);
        const seen = new Set([tag]);
        for (let up = parent; up; up = parents[up]) {
            if (seen.has(up)) throw new Error(`parents.json: cycle through ${tag}`);
            seen.add(up);
        }
    });
    let count = 0;
    doc.tags = doc.tags.map((entry) => {
        // `parent` goes after the aliases, where a reader of the file looks.
        const { tag, aliases, parent: _old, ...rest } = entry;
        const parent = parents[tag];
        if (parent) count += 1;
        return parent ? { tag, aliases, parent, ...rest } : { tag, aliases, ...rest };
    });
    doc.version = 3;
    return count;
}

module.exports = { applyParents };
