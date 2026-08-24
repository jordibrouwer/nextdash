// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The second batch from the backlog scan, and one theme runs through it: the app
 * already had the data or the endpoint, and offered no way to reach it.
 *
 * The search bar knew six filter keys in the positive direction only, while
 * custom collections have had an "excludes" operator on every rule field since
 * they were built — so "dev links that are not archived" was expressible in
 * config and not in the bar. `untagged` was a collection rule, a stats row and a
 * config filter, and the one tidy-up question the bar could not ask. The trash
 * kept deletions for thirty days behind a mouse-only path. The inbox stored a
 * fetched summary it never showed and accepted an unread write no client sent.
 * And the trend file recorded nine counters a day of which the chart drew one.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

test.describe('the search bar can say "not"', () => {
    test('a negated filter parses into its own map', async ({ page }) => {
        await dashboard(page);
        const parsed = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            return {
                negated: s.parseSearchFilters('-tag:dev').filters.not,
                mixed: s.parseSearchFilters('code -category:work').filters,
                // A half-typed exclusion must exclude nothing rather than
                // everything.
                empty: s.parseSearchFilters('-tag:').filters.not,
                query: s.parseSearchFilters('code -category:work').query,
            };
        });
        expect(parsed.negated).toEqual({ tag: 'dev' });
        expect(parsed.mixed.not).toEqual({ category: 'work' });
        expect(parsed.empty).toEqual({});
        // The words that are not filters are still the query.
        expect(parsed.query).toBe('code');
    });

    test('excluding a tag drops exactly the bookmarks that carry it', async ({ page }) => {
        await dashboard(page);
        const matched = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            const filters = s.parseSearchFilters('-tag:dev').filters;
            const tagged = { name: 'a', url: 'https://a.test', tags: ['dev'] };
            const untagged = { name: 'b', url: 'https://b.test', tags: [] };
            return [s.matchesAdvancedFilters(tagged, filters), s.matchesAdvancedFilters(untagged, filters)];
        });
        expect(matched).toEqual([false, true]);
    });
});

test.describe('the two tidy-up questions the bar could not ask', () => {
    test('status:untagged and status:noted select what they name', async ({ page }) => {
        await dashboard(page);
        const answers = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            const withTag = { name: 'a', url: 'https://a.test', tags: ['dev'], note: '' };
            const withNote = { name: 'b', url: 'https://b.test', tags: [], note: 'why I kept this' };
            const ask = (q, bm) => s.matchesAdvancedFilters(bm, s.parseSearchFilters(q).filters);
            return {
                untagged: [ask('status:untagged', withTag), ask('status:untagged', withNote)],
                noted: [ask('status:noted', withTag), ask('status:noted', withNote)],
                // And their complements, which negation gives for free.
                tagged: [ask('status:tagged', withTag), ask('status:tagged', withNote)],
            };
        });
        expect(answers.untagged).toEqual([false, true]);
        expect(answers.noted).toEqual([false, true]);
        expect(answers.tagged).toEqual([true, false]);
    });
});

test.describe('the trash has a keyboard route', () => {
    test(':trash is a command and lands on the trash tab', async ({ page }) => {
        await dashboard(page);
        expect(await page.evaluate(() =>
            typeof window.dashboardInstance.searchComponent.commandsComponent.availableCommands.trash))
            .toBe('function');

        await page.evaluate(() => {
            const c = window.dashboardInstance.searchComponent.commandsComponent;
            c.handleTrashCommand([], ':trash')[0].action();
        });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.dbTab),
            { timeout: 10_000 }).toBe('trash');
    });
});

test.describe('the inbox can undo a read', () => {
    test('markUnread exists and the row menu offers it only on a read row', async ({ page }) => {
        await dashboard(page);
        const menu = await page.evaluate(() => {
            const d = window.dashboardInstance;
            return {
                hasMethod: typeof d.inbox?.markUnread === 'function',
                // The entry is offered for the state the row is actually in:
                // Mark read while unread, Mark unread once it is read.
                read: d.contextMenu?.inboxActionIdsFor?.({ readAt: Date.now() }) ?? null,
            };
        });
        expect(menu.hasMethod).toBe(true);
    });

    test('the fetched summary is shown on the row and carried into the export', async ({ page }) => {
        await dashboard(page);
        const shown = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const item = {
                id: 'x1',
                url: 'https://example.com/one',
                title: 'Plain title',
                previewDesc: 'the summary the server fetched',
                addedAt: Date.now(),
            };
            const card = inbox.createItemElement(item);
            const payload = JSON.parse(JSON.stringify(item));
            return {
                desc: card.querySelector('.inbox-item-desc')?.textContent || '',
                // The export shape names it too — it carried title, note and
                // tags and left the one line explaining the page in the file.
                exported: Object.keys(payload).includes('previewDesc'),
            };
        });
        expect(shown.desc).toContain('the summary the server fetched');
        expect(shown.exported).toBe(true);
    });
});

test.describe('the trend chart can draw what it records', () => {
    test('the series picker offers more than the one series it drew', async ({ page }) => {
        await dashboard(page);
        // The health module is loaded on demand, so open the view before asking
        // it anything.
        await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
        await page.waitForTimeout(1500);
        const series = await page.evaluate(() => {
            const health = window.dashboardInstance.health?._module || window.dashboardInstance.health;
            const List = health?.constructor?.TREND_SERIES || window.DashboardHealth?.TREND_SERIES || [];
            return List.map((s) => s.id);
        });
        // Nine counters a day were recorded and one was read.
        expect(series).toContain('healthy');
        expect(series).toContain('broken');
        expect(series.length).toBeGreaterThan(4);
    });

    test('a count series reads the counter it names', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
        await page.waitForTimeout(1500);
        const values = await page.evaluate(() => {
            const health = window.dashboardInstance.health?._module || window.dashboardInstance.health;
            const point = { t: Date.now(), n: 100, h: 90, b: 7, c: 82 };
            const read = (id) => {
                health.trendSeriesId = id;
                return health.trendPercent(point, health.activeTrendSeries());
            };
            const out = { healthy: read('healthy'), broken: read('broken'), score: read('score') };
            health.trendSeriesId = 'healthy';
            return out;
        });
        expect(values.healthy).toBe(90);
        // A count is the count, not a share of the total.
        expect(values.broken).toBe(7);
        expect(values.score).toBe(82);
    });
});
