// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, waitForConfigReady } = require('./e2e-helpers');

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

test.describe('the suggestions panel', () => {
    test('offers a group, and applying it tags exactly those bookmarks', async ({ page }) => {
        await open(page);
        // dashboardInstance.config is a lazy-loading stub until the app has
        // finished wiring itself up; window.TagSuggestions loads eagerly and
        // much earlier, so open()'s wait alone is not enough here.
        await waitForConfigReady(page);
        // Four bookmarks on one host, three already tagged: the fourth is the
        // one the panel should offer to catch up.
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://plan.example/one', tags: ['code'] },
                { name: 'Two', url: 'https://plan.example/two', tags: ['code'] },
                { name: 'Three', url: 'https://plan.example/three', tags: ['code'] },
                { name: 'Four', url: 'https://plan.example/four', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        const panel = page.locator('#config-bm-suggestions');
        await expect(panel).toBeVisible({ timeout: 15_000 });

        const row = panel.locator('[data-tag-suggestion]').filter({ hasText: 'code' }).first();
        await expect(row).toContainText('plan.example');
        await row.locator('[data-tag-suggestion-apply]').click();

        await expect.poll(async () => page.evaluate(() =>
            (window.dashboardInstance.allBookmarks || [])
                .filter((b) => b.url.includes('plan.example') && (b.tags || []).includes('code')).length),
        { timeout: 15_000 }).toBe(4);
    });

    test('a rule you write survives a reload and proposes on its own', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config.writeFetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 1, bookmark: { name: 'X', url: 'https://ruled.example/x' } }),
            });
            const cfg = d.config?.instance || d.config;
            await cfg.addTagRule('ruled.example', 'work');
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => !!window.dashboardInstance?.settings, null, { timeout: 15_000 });

        const stored = await page.evaluate(() => window.dashboardInstance.settings.tagRules);
        expect(stored).toContainEqual({ pattern: 'ruled.example', tag: 'work' });

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        const row = page.locator('#config-bm-suggestions [data-tag-suggestion]').filter({ hasText: 'work' });
        await expect(row.first()).toBeVisible({ timeout: 15_000 });
    });
});
