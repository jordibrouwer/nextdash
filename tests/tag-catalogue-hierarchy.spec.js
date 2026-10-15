// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The catalogue is a tree: a subject may name a broader `parent`. The engine
 * offers the finest subject the reader has a word for -- their own tag for it,
 * or for any subject above it -- and turning a broader tag down on a site turns
 * down what sits under it there too.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.TagSuggestions, null, { timeout: 15_000 });
}

const items = (rows) => rows.map(([key, url, tags]) => ({ key, url, tags: tags || [] }));

// sports > soccer (alias futbol) > premier-league; one host under the leaf.
const CATALOGUE = [
    { tag: 'sports', aliases: ['sport'], hosts: [] },
    { tag: 'soccer', aliases: ['futbol'], parent: 'sports', hosts: [] },
    { tag: 'premier-league', aliases: ['epl'], parent: 'soccer', hosts: ['league.example'] },
];

const offerFor = (page, rows, options = {}) => page.evaluate(({ rows: r, options: o, catalogue }) => {
    const groups = window.TagSuggestions.suggest(r, { catalogue, ...o });
    return groups.filter((g) => g.keys.includes('target')).map((g) => g.tag);
}, { rows, options, catalogue: CATALOGUE });

test('a reader with no word on the chain is offered the subject itself', async ({ page }) => {
    await open(page);
    expect(await offerFor(page, items([['target', 'https://league.example/a', []]]))).toEqual(['premier-league']);
});

test('a reader who tags the parent is offered the parent', async ({ page }) => {
    await open(page);
    const rows = items([
        ['other', 'https://elsewhere.example/x', ['soccer']],
        ['target', 'https://league.example/a', []],
    ]);
    expect(await offerFor(page, rows)).toEqual(['soccer']);
});

test("a parent's alias counts, and the nearest ancestor wins", async ({ page }) => {
    await open(page);
    const rows = items([
        ['one', 'https://elsewhere.example/x', ['futbol']],
        ['two', 'https://other.example/y', ['sports']],
        ['target', 'https://league.example/a', []],
    ]);
    expect(await offerFor(page, rows)).toEqual(['futbol']);
});

test('the reader\'s own word for the subject beats its parent', async ({ page }) => {
    await open(page);
    const rows = items([
        ['one', 'https://elsewhere.example/x', ['soccer']],
        ['two', 'https://other.example/y', ['epl']],
        ['target', 'https://league.example/a', []],
    ]);
    expect(await offerFor(page, rows)).toEqual(['epl']);
});

test('turning the parent down on a site turns the child down there too', async ({ page }) => {
    await open(page);
    const rows = items([['target', 'https://league.example/a', []]]);
    expect(await offerFor(page, rows, { dismissed: ['league.example|soccer'] })).toEqual([]);
    // Another site's refusal does not reach it.
    expect(await offerFor(page, rows, { dismissed: ['elsewhere.example|soccer'] })).toEqual(['premier-league']);
});

test('a cycle in the file ends the chain instead of the page', async ({ page }) => {
    await open(page);
    const got = await page.evaluate((r) => window.TagSuggestions.suggest(r, {
        catalogue: [
            { tag: 'a', aliases: [], parent: 'b', hosts: ['loop.example'] },
            { tag: 'b', aliases: [], parent: 'a', hosts: [] },
        ],
    }).map((g) => g.tag), items([['target', 'https://loop.example/', []]]));
    expect(got).toEqual(['a']);
});
