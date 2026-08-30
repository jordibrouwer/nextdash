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

/*
 * Ranking by what you actually open.
 *
 * The scorer read the shape of the string and nothing else, so it ranked the
 * same way on day one and day one thousand. `openCount` and `lastOpened` have
 * been stored on every bookmark all along — they drive the smart collections,
 * the stats page and the `opened:` filter — and search looked at neither.
 *
 * The bonus stays small on purpose. Tiers sit 200 apart and the ratio bonus
 * already spends up to 99 of that, so usage gets at most 90: enough to settle
 * which of two equals goes first, never enough to lift a name you typed past
 * one you did not.
 */
const DAY = 86400000;
const now = Date.now();

test('between two equals, the one you open more goes first', () => {
    const fuzzy = loadFuzzy([
        { name: 'Gmaps', url: 'https://maps.example', openCount: 1, lastOpened: now - DAY },
        { name: 'Gmail', url: 'https://mail.example', openCount: 40, lastOpened: now - DAY },
    ]);
    // Both are name-prefix matches of the same length, so the string score is
    // identical and only the opens can separate them.
    assert.deepStrictEqual(fuzzy.handleFuzzy('gm').map(r => r.name), ['Gmail', 'Gmaps']);
});

test('opens cannot lift a weak match over a strong one', () => {
    const fuzzy = loadFuzzy([
        { name: 'widGetonderzoek', url: 'https://w.example', openCount: 9999, lastOpened: now },
        { name: 'Github', url: 'https://gh.example', openCount: 0 },
    ]);
    // The whole point of the tiers is that typing the start of a name beats
    // typing a letter buried in one. A favourite must not overturn that.
    assert.deepStrictEqual(fuzzy.handleFuzzy('g').map(r => r.name), ['Github', 'widGetonderzoek']);
});

test('between two equals, the one you opened recently goes first', () => {
    const fuzzy = loadFuzzy([
        { name: 'Gmaps', url: 'https://maps.example', openCount: 10, lastOpened: now - 400 * DAY },
        { name: 'Gmail', url: 'https://mail.example', openCount: 10, lastOpened: now - DAY },
    ]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('gm').map(r => r.name), ['Gmail', 'Gmaps']);
});

test('a bookmark that was never opened still ranks', () => {
    const fuzzy = loadFuzzy([{ name: 'Gmail', url: 'https://mail.example' }]);
    const results = fuzzy.handleFuzzy('gm');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'Gmail');
});

test('usage does not change which group a result lands in', () => {
    // The group is decided on the string alone. If the bonus were added before
    // that, a much-opened mid-word match could climb past 500 and be announced
    // as a best match, which is the confusion this all started with.
    const fuzzy = loadFuzzy([
        { name: 'widGetonderzoek', url: 'https://w.example', openCount: 9999, lastOpened: now },
    ]);
    assert.strictEqual(groupOf(fuzzy.handleFuzzy('g'), 'widGetonderzoek'), 'contains');
});

/*
 * Ranking by what you picked, for the keystrokes you picked it with.
 *
 * Layer A settles ties between equals. This settles the case the string can
 * never get right: "mail" reaches `Mailcow` by its first letters and `Gmail`
 * by a substring, so the shape of the words says Mailcow and ten years of you
 * pressing Enter on Gmail says otherwise. The keystrokes are an alias you
 * already taught it; it just was not listening.
 *
 * A picked result joins the best matches, because a choice you made for these
 * exact keystrokes is better evidence than where the letters happen to fall.
 * It still loses to an exact name: typing a thing's full name has to give you
 * that thing.
 */
const pick = (q, url, n = 1, at = now) => ({ q, url, n, at });

test('what you picked for these keystrokes leads the list', () => {
    const fuzzy = loadFuzzy([
        { name: 'Mailcow', url: 'https://mailcow.example' },
        { name: 'Gmail', url: 'https://mail.example' },
    ]);
    // Without the memory the shape wins: Mailcow is a name prefix, Gmail only
    // carries "mail" mid-word.
    assert.deepStrictEqual(fuzzy.handleFuzzy('mail').map(r => r.name), ['Mailcow', 'Gmail']);

    fuzzy.updatePicks([pick('mail', 'https://mail.example', 6)]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('mail').map(r => r.name), ['Gmail', 'Mailcow']);
});

test('a picked result is announced as a best match, not left in a folded group', () => {
    // Otherwise the group it was promoted past renders above it, and the thing
    // that scored highest is the thing you cannot see.
    const fuzzy = loadFuzzy([{ name: 'Gmail', url: 'https://mail.example' }]);
    fuzzy.updatePicks([pick('mail', 'https://mail.example', 6)]);
    assert.strictEqual(groupOf(fuzzy.handleFuzzy('mail'), 'Gmail'), 'strong');
});

test('the memory is keyed to the keystrokes, not the bookmark', () => {
    const fuzzy = loadFuzzy([
        { name: 'Mailcow', url: 'https://mailcow.example' },
        { name: 'Gmail', url: 'https://mail.example' },
    ]);
    // Picked for "mail" — that says nothing about what "ma" means.
    fuzzy.updatePicks([pick('mail', 'https://mail.example', 6)]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('ma').map(r => r.name), ['Mailcow', 'Gmail']);
});

test('an exact name still beats what you usually pick', () => {
    const fuzzy = loadFuzzy([
        { name: 'Github', url: 'https://github.example' },
        { name: 'Github Issues', url: 'https://issues.example' },
    ]);
    fuzzy.updatePicks([pick('github', 'https://issues.example', 10)]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('github').map(r => r.name), ['Github', 'Github Issues']);
});

test('picked more often leads picked once', () => {
    const fuzzy = loadFuzzy([
        { name: 'Alpha', url: 'https://a.example' },
        { name: 'Alpine', url: 'https://b.example' },
    ]);
    fuzzy.updatePicks([
        pick('al', 'https://a.example', 1),
        pick('al', 'https://b.example', 9),
    ]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('al').map(r => r.name), ['Alpine', 'Alpha']);
});

test('a pick cannot conjure a result the query does not match', () => {
    const fuzzy = loadFuzzy([{ name: 'Gmail', url: 'https://mail.example' }]);
    fuzzy.updatePicks([pick('zzz', 'https://mail.example', 9)]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('zzz').map(r => r.name), []);
});

test('a pick from long ago counts for less than a fresh one', () => {
    const fuzzy = loadFuzzy([
        { name: 'Alpha', url: 'https://a.example' },
        { name: 'Alpine', url: 'https://b.example' },
    ]);
    fuzzy.updatePicks([
        pick('al', 'https://a.example', 4, now - 400 * DAY),
        pick('al', 'https://b.example', 4, now),
    ]);
    assert.deepStrictEqual(fuzzy.handleFuzzy('al').map(r => r.name), ['Alpine', 'Alpha']);
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
