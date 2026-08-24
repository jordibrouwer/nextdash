// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * "Which bookmarks" was answered in three places.
 *
 * The search bar had `status:untagged`, the config list had a cleanup filter
 * called Without tags, and the statistics panel counted its own — the same
 * question, three implementations, free to disagree about a tag made of spaces
 * or a note that is a single newline. They share one registry now, and this is
 * what says so: the same awkward bookmarks put through both paths have to come
 * out the same way.
 */

const AWKWARD = [
    { name: 'Spaces for tags', url: 'https://a.example/', tags: ['   ', ''], note: '' },
    { name: 'A real tag', url: 'https://b.example/', tags: ['dev'], note: '  ' },
    { name: 'A note of spaces', url: 'https://c.example/', tags: [], note: '   ' },
    { name: 'A real note', url: 'https://d.example/', tags: [], note: 'why I kept this' },
    { name: 'Never opened', url: 'https://e.example/', tags: [], openCount: 0, lastOpened: 0 },
    { name: 'Counted but undated', url: 'https://f.example/', tags: [], openCount: 3, lastOpened: 0 },
    { name: 'Opened once', url: 'https://g.example/', tags: [], openCount: 1, lastOpened: Date.now() },
    { name: 'Plain http', url: 'http://h.example/', tags: [] },
];

test.describe('one answer to "which bookmarks"', () => {
    test('the search bar and the cleanup filters agree, awkward cases and all', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // The config module loads on first use, and CLEANUP_FILTERS lives on it.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 15_000 });

        const verdicts = await page.evaluate((rows) => {
            const d = window.dashboardInstance;
            const search = d.searchComponent || d.search;
            const K = window.DashboardConfig;
            const out = {};
            for (const name of ['untagged', 'never', 'once', 'insecure', 'noicon']) {
                const viaFilter = rows.filter((b) => K.CLEANUP_FILTERS[name](b)).map((b) => b.name);
                const viaShared = rows.filter((b) => window.BookmarkPredicates.match(name, b)).map((b) => b.name);
                out[name] = { viaFilter, viaShared };
            }
            // The search bar's own path, for the two it can ask about.
            out.searchUntagged = rows.filter((b) => search.matchesFilterKey(b, 'status', 'untagged')).map((b) => b.name);
            out.searchNoted = rows.filter((b) => search.matchesFilterKey(b, 'status', 'noted')).map((b) => b.name);
            out.sharedNoted = rows.filter((b) => window.BookmarkPredicates.match('noted', b)).map((b) => b.name);
            return out;
        }, AWKWARD);

        for (const name of ['untagged', 'never', 'once', 'insecure', 'noicon']) {
            expect(verdicts[name].viaFilter, `${name} disagrees`).toEqual(verdicts[name].viaShared);
        }
        // A tag of spaces is not a tag, in both places.
        expect(verdicts.searchUntagged).toEqual(verdicts.untagged.viaFilter);
        expect(verdicts.searchUntagged).toContain('Spaces for tags');
        // And a note of spaces is not a note.
        expect(verdicts.searchNoted).toEqual(verdicts.sharedNoted);
        expect(verdicts.searchNoted).toEqual(['A real note']);
    });

    test('a count with no date still reads as opened', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });

        // An import can carry a count with no timestamp, and a restore the other
        // way round; "never opened" has to mean neither.
        const never = await page.evaluate((rows) => rows
            .filter((b) => window.BookmarkPredicates.match('never', b))
            .map((b) => b.name), AWKWARD);
        expect(never).toContain('Never opened');
        expect(never).not.toContain('Counted but undated');
        expect(never).not.toContain('Opened once');
    });
});
