'use strict';

/**
 * A search result has to say why it matched, not just how well.
 *
 * The scorer knew the difference all along — a name that starts with the query
 * scores 700, a name that merely contains it scores 300 — but it threw that
 * away and kept the number. The list then rendered `Gmail` and
 * `widGetonderzoek` as the same kind of row, and one letter filled the screen.
 *
 * The number cannot be reverse-engineered back into a reason: an exact domain
 * match is 1000 * 0.3 = 300, exactly what a mid-name substring scores. So the
 * branch that sets the score has to label it.
 *
 * Run with: node tests/search-result-groups.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function loadFuzzy(bookmarks) {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'static', 'js', 'fuzzy-search.js'), 'utf8');
    global.window = {};
    // eslint-disable-next-line no-eval
    eval(src);
    return new global.window.FuzzySearchComponent(bookmarks, () => {});
}

function groupOf(results, name) {
    const hit = results.find((r) => r.name === name);
    assert.ok(hit, `expected a result named ${name}, got: ${results.map(r => r.name).join(', ')}`);
    return hit.group;
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('a name that starts with the query is a strong match', () => {
    const fuzzy = loadFuzzy([{ name: 'Gmail', url: 'https://mail.google.com' }]);
    const results = fuzzy.handleFuzzy('g');
    assert.strictEqual(groupOf(results, 'Gmail'), 'strong');
});

test('a word inside the name starting with the query is a strong match', () => {
    const fuzzy = loadFuzzy([{ name: 'MD5 Hash Generator', url: 'https://example.com' }]);
    const results = fuzzy.handleFuzzy('g');
    assert.strictEqual(groupOf(results, 'MD5 Hash Generator'), 'strong');
});

test('an exact name is a strong match', () => {
    const fuzzy = loadFuzzy([{ name: 'Gmail', url: 'https://mail.google.com' }]);
    const results = fuzzy.handleFuzzy('gmail');
    assert.strictEqual(groupOf(results, 'Gmail'), 'strong');
});

test('the query buried mid-word is a contains match', () => {
    const fuzzy = loadFuzzy([{ name: 'widGetonderzoek', url: 'https://example.com' }]);
    const results = fuzzy.handleFuzzy('g');
    assert.strictEqual(groupOf(results, 'widGetonderzoek'), 'contains');
});

test('a domain match is elsewhere, not contains, even though it scores 300', () => {
    // scoreMatch('example', 'example') = 1000 + ratio, scaled by 0.3 -> 300.
    // A mid-name substring scores 300 too. Only the branch knows the difference.
    const fuzzy = loadFuzzy([{ name: 'Untitled', url: 'https://example' }]);
    const results = fuzzy.handleFuzzy('example');
    assert.strictEqual(groupOf(results, 'Untitled'), 'elsewhere');
});

test('a tag match is elsewhere', () => {
    const fuzzy = loadFuzzy([{ name: 'Untitled', url: 'https://a.test', tags: ['media'] }]);
    const results = fuzzy.handleFuzzy('media');
    assert.strictEqual(groupOf(results, 'Untitled'), 'elsewhere');
});

test('a note match is elsewhere', () => {
    const fuzzy = loadFuzzy([{ name: 'Untitled', url: 'https://a.test', note: 'the quarterly report' }]);
    const results = fuzzy.handleFuzzy('quarterly');
    assert.strictEqual(groupOf(results, 'Untitled'), 'elsewhere');
});

test('a page-description match is elsewhere', () => {
    const fuzzy = loadFuzzy([{ name: 'Untitled', url: 'https://a.test', previewDesc: 'a comic reader' }]);
    const results = fuzzy.handleFuzzy('comic');
    assert.strictEqual(groupOf(results, 'Untitled'), 'elsewhere');
});

test('strong matches still sort above contains matches', () => {
    const fuzzy = loadFuzzy([
        { name: 'widGetonderzoek', url: 'https://a.test' },
        { name: 'Gmail', url: 'https://b.test' },
    ]);
    const results = fuzzy.handleFuzzy('g');
    assert.deepStrictEqual(results.map(r => r.name), ['Gmail', 'widGetonderzoek']);
});

let failed = 0;
for (const [name, fn] of tests) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failed++;
        console.log(`  FAIL ${name}`);
        console.log(`       ${err.message}`);
    }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 1 - 1 : 1);
