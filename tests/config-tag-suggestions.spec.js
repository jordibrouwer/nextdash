// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, waitForConfigReady } = require('./e2e-helpers');

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.TagSuggestions, null, { timeout: 15_000 });
}

const items = (rows) => rows.map(([key, url, tags]) => ({ key, url, tags: tags || [] }));

/**
 * Config -> Bookmarks -> Tag suggestions, through the strip the reader clicks
 * rather than by setting bmTab by hand.
 */
async function openSuggestionsTab(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    const tab = page.locator('[data-bm-tab="tag-suggestions"]');
    await tab.click({ timeout: 15_000 });
    await expect(page.locator('#config-bm-suggestions')).toBeVisible({ timeout: 15_000 });
}

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

    test('a rule that only restates a group the app already noticed is one row, not two', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows, {
            rules: [{ pattern: 'github.com', tag: 'code' }],
        }), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        // The rule and the pattern the app derived agree on tag and on
        // bookmark, so the reader is offered it once -- and the rule wins,
        // because it is the reason they would recognise.
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ tag: 'code', pattern: 'github.com', source: 'rule', keys: ['d'] });
    });

    test('the biggest group is offered first, however specific the others are', async ({ page }) => {
        await open(page);
        const patterns = await page.evaluate((rows) => window.TagSuggestions.suggest(rows)
            .map((g) => `${g.pattern}:${g.keys.length}`), items([
            ['m1', 'https://many.example/one/a', ['code']],
            ['m2', 'https://many.example/two/a', ['code']],
            ['m3', 'https://many.example/three/a', ['code']],
            ['m4', 'https://many.example/four/a', []],
            ['m5', 'https://many.example/five/a', []],
            ['m6', 'https://many.example/six/a', []],
            ['m7', 'https://many.example/seven/a', []],
            ['m8', 'https://many.example/eight/a', []],
            ['s1', 'https://small.example/r/one', ['wiki']],
            ['s2', 'https://small.example/r/two', ['wiki']],
            ['s3', 'https://small.example/r/three', []],
            ['s4', 'https://small.example/r/four', []],
        ]));
        // The narrower small.example/r group still outranks the bare host for
        // resolving a conflict, but five bookmarks are worth reading before
        // two.
        expect(patterns).toEqual(['many.example:5', 'small.example/r:2']);
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
        await openSuggestionsTab(page);
        const panel = page.locator('#config-bm-suggestions');

        const row = panel.locator('[data-tag-suggestion]').filter({ hasText: 'code' }).first();
        await expect(row).toContainText('plan.example');
        await row.locator('[data-tag-suggestion-apply]').click();

        const tagged = async () => page.evaluate(() =>
            (window.dashboardInstance.allBookmarks || [])
                .filter((b) => b.url.includes('plan.example') && (b.tags || []).includes('code')).length);
        await expect.poll(tagged, { timeout: 15_000 }).toBe(4);
        // Wait for the panel to catch up before undoing, so what it shows
        // afterwards is the undo's doing and not a repaint that had not landed.
        const offered = panel.locator('[data-tag-suggestion]').filter({ hasText: 'plan.example' });
        await expect(offered).toHaveCount(0, { timeout: 15_000 });

        // It went through the bulk path, so the toast's own Undo puts the
        // previous tags back -- the three that were already tagged stay tagged,
        // the fourth loses what the panel just gave it.
        const undo = page.locator('.app-notification.show .app-notification-action');
        await expect(undo).toBeVisible({ timeout: 15_000 });
        await undo.click();
        await expect.poll(tagged, { timeout: 15_000 }).toBe(3);

        // And the panel is offering plan.example again, rather than still
        // showing the collection as it was before the undo.
        await expect(offered).toHaveCount(1, { timeout: 15_000 });
    });

    test('caps how many rows it draws, and says how many are waiting', async ({ page }) => {
        await open(page);
        await page.waitForFunction(() => !!window.ConfigTagSuggestions, null, { timeout: 15_000 });
        const drawn = await page.evaluate(() => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            // Thirty hosts, each three tagged and one not: thirty groups, more
            // than the panel is willing to put on screen at once.
            const rows = [];
            for (let h = 0; h < 30; h += 1) {
                for (let i = 0; i < 4; i += 1) {
                    rows.push({
                        key: `h${h}-${i}`,
                        url: `https://host${h}.example/page${i}`,
                        tags: i < 3 ? ['code'] : [],
                    });
                }
            }
            const groups = window.ConfigTagSuggestions.render(host, {
                items: rows, rules: [], t: (key, fallback) => fallback,
            });
            const notice = host.querySelector('[data-tag-suggestions-capped]');
            const result = {
                groups: groups.length,
                rows: host.querySelectorAll('[data-tag-suggestion]').length,
                notice: notice ? notice.textContent : '',
            };
            host.remove();
            return result;
        });
        expect(drawn.groups).toBe(30);
        expect(drawn.rows).toBe(25);
        expect(drawn.notice).toContain('25');
        expect(drawn.notice).toContain('30');
    });

    test('the rules editor folds away, and is still folded after a reload', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await openSuggestionsTab(page);
        const details = page.locator('#config-tag-rules-details');
        await expect(details).toBeVisible({ timeout: 15_000 });

        // Whatever it started as, the reader's click is what has to survive.
        const wasOpen = await details.evaluate((el) => el.open);
        await details.locator('summary').click();
        await expect.poll(() => details.evaluate((el) => el.open), { timeout: 5_000 }).toBe(!wasOpen);

        await page.reload({ waitUntil: 'networkidle' });
        await waitForConfigReady(page);
        await openSuggestionsTab(page);
        const after = page.locator('#config-tag-rules-details');
        await expect(after).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => after.evaluate((el) => el.open), { timeout: 5_000 }).toBe(!wasOpen);
    });

    test('the info button explains the panel', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await openSuggestionsTab(page);
        const details = page.locator('#config-tag-rules-details');
        await expect(details).toBeVisible({ timeout: 15_000 });
        const before = await details.evaluate((el) => el.open);

        await page.locator('#config-bm-suggestions [data-tag-suggestions-info]').click();
        // The same AppModal every other config info button opens.
        await expect(page.locator('.app-modal, .modal-overlay').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).toContainText('Apply', { timeout: 15_000 });
        // And it left the rules editor as it found it: the button sits in the
        // head of the tab now, not in that <summary>.
        expect(await details.evaluate((el) => el.open)).toBe(before);
    });

    test('a pattern the server would drop is refused with a reason', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await openSuggestionsTab(page);
        const panel = page.locator('#config-bm-suggestions');

        const before = await page.evaluate(() =>
            (window.dashboardInstance.settings.tagRules || []).length);

        // The editor folds, and an earlier test may have left it shut in this
        // browser's storage -- open it the way the reader would.
        const rules = page.locator('#config-tag-rules-details');
        if (!await rules.evaluate((el) => el.open)) {
            await rules.locator('summary').click();
        }
        await panel.locator('[data-tag-rule-pattern]').fill('reddit.com/r/selfhosted');
        await panel.locator('[data-tag-rule-tag]').fill('homelab');
        await panel.locator('[data-tag-rule-add]').click();

        const error = panel.locator('[data-tag-rule-error]');
        await expect(error).toBeVisible({ timeout: 15_000 });
        await expect(error).toContainText('segment');
        // And nothing was written: sanitizeTagRules would have dropped it in
        // silence, which is the whole reason the message exists.
        expect(await page.evaluate(() =>
            (window.dashboardInstance.settings.tagRules || []).length)).toBe(before);
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

        await openSuggestionsTab(page);
        const row = page.locator('#config-bm-suggestions [data-tag-suggestion]').filter({ hasText: 'work' });
        await expect(row.first()).toBeVisible({ timeout: 15_000 });
    });
});
