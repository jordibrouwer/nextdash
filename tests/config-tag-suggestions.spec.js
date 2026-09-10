// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.TagSuggestions, null, { timeout: 15_000 });
}

const items = (rows) => rows.map(([key, url, tags]) => ({ key, url, tags: tags || [] }));

test.describe('the tag suggestion engine', () => {
    test('reads a pattern from a URL, host first and host plus segment after', async ({ page }) => {
        await open(page);
        const got = await page.evaluate(() => ({
            plain: window.TagSuggestions.patternsFor('https://www.GitHub.com/jordibrouwer/nextdash'),
            root: window.TagSuggestions.patternsFor('https://example.com'),
            refused: window.TagSuggestions.patternsFor('mailto:someone@example.com'),
        }));
        expect(got.plain).toEqual(['github.com', 'github.com/jordibrouwer']);
        expect(got.root).toEqual(['example.com']);
        expect(got.refused).toEqual([]);
    });

    test('proposes the tag the rest of the group already carries', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            tag: 'code', pattern: 'github.com', source: 'derived', keys: ['d'],
        });
        expect(groups[0].reason).toEqual({ kind: 'derived', have: 3, of: 3 });
    });

    test('says nothing when the group is too small or too split', async ({ page }) => {
        await open(page);
        const got = await page.evaluate((sets) => ({
            small: window.TagSuggestions.suggest(sets.small),
            split: window.TagSuggestions.suggest(sets.split),
        }), {
            small: items([['a', 'https://tiny.example/one', ['code']], ['b', 'https://tiny.example/two', []]]),
            split: items([
                ['a', 'https://mixed.example/one', ['code']],
                ['b', 'https://mixed.example/two', ['news']],
                ['c', 'https://mixed.example/three', ['video']],
                ['d', 'https://mixed.example/four', []],
            ]),
        });
        expect(got.small).toEqual([]);
        expect(got.split).toEqual([]);
    });

    test('a rule wins, and needs no group behind it', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows, {
            rules: [{ pattern: 'github.com', tag: 'work' }],
        }), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        const byTag = Object.fromEntries(groups.map((g) => [g.tag, g]));
        expect(byTag.work.source).toBe('rule');
        expect(byTag.work.keys.sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(byTag.code.keys).toEqual(['d']);
    });

    test('no bookmark is offered more than two tags', async ({ page }) => {
        await open(page);
        const perKey = await page.evaluate((rows) => {
            const groups = window.TagSuggestions.suggest(rows, {
                rules: [
                    { pattern: 'github.com', tag: 'one' },
                    { pattern: 'github.com', tag: 'two' },
                    { pattern: 'github.com', tag: 'three' },
                ],
            });
            const counts = {};
            groups.forEach((g) => g.keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
            return counts;
        }, items([['a', 'https://github.com/one', []]]));
        expect(perKey.a).toBe(2);
    });
});
