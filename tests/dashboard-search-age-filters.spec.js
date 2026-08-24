// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * `opened:` and `added:` were only half wired up.
 *
 * The parser understood them and matchesAdvancedFilters applied them, but the
 * autocomplete carried its own hardcoded list of four keys. So the two age
 * filters worked when typed out in full, while being absent from the hint panel,
 * unoffered as a prefix, and — the one that shows — never recognised as a
 * finished filter query, so the completion list kept firing on top of real
 * results instead of getting out of the way.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.searchComponent, null, { timeout: 20_000 });
}

const search = (page, fn) => page.evaluate(
    // eslint-disable-next-line no-new-func
    (body) => new Function('s', `return (${body})(s);`)(window.dashboardInstance.searchComponent),
    fn.toString());

test.describe('the age filters are offered like every other filter', () => {
    test('the hint panel lists them', async ({ page }) => {
        await openDashboard(page);
        const completions = await search(page,
            (s) => s.getFilterHintItems().map((item) => item.completion.trim()));

        expect(completions).toContain('opened:');
        expect(completions).toContain('added:');
        // And the four that were always there are still there.
        expect(completions).toEqual(
            expect.arrayContaining(['category:', 'status:', 'page:', 'tag:']));
    });

    test('typing a prefix suggests them', async ({ page }) => {
        await openDashboard(page);

        const fromOpen = await search(page,
            (s) => s.getFilterAutocompleteMatches('open').map((m) => m.completion.trim()));
        expect(fromOpen).toContain('opened:');

        const fromAdd = await search(page,
            (s) => s.getFilterAutocompleteMatches('add').map((m) => m.completion.trim()));
        expect(fromAdd).toContain('added:');
    });

    test('the incomplete-query check recognises a half-typed key', async ({ page }) => {
        await openDashboard(page);
        expect(await search(page, (s) => s._isIncompleteFilterQuery('open'))).toBe(true);
        expect(await search(page, (s) => s._isIncompleteFilterQuery('opened:'))).toBe(true);
        expect(await search(page, (s) => s._isIncompleteFilterQuery('added:'))).toBe(true);
        // Something that is not a filter key at all still is not one.
        expect(await search(page, (s) => s._isIncompleteFilterQuery('zebra:'))).toBe(false);
    });

    test('a finished age filter counts as finished', async ({ page }) => {
        await openDashboard(page);
        expect(await search(page, (s) => s._isCompleteFilterQuery('opened:week'))).toBe(true);
        expect(await search(page, (s) => s._isCompleteFilterQuery('added:month'))).toBe(true);
        // `never` says something under opened:, nothing under added:.
        expect(await search(page, (s) => s._isCompleteFilterQuery('opened:never'))).toBe(true);
        expect(await search(page, (s) => s._isCompleteFilterQuery('added:never'))).toBe(false);
        // A word matchesAgeFilter does not know is not a finished query either,
        // or the completion list would go quiet on a typo.
        expect(await search(page, (s) => s._isCompleteFilterQuery('added:banana'))).toBe(false);
    });

    test('the values are suggested once the key is typed', async ({ page }) => {
        await openDashboard(page);

        const opened = await search(page,
            (s) => s.getFilterAutocompleteMatches('opened:').map((m) => m.completion.trim()));
        expect(opened).toEqual(
            ['opened:today', 'opened:week', 'opened:month', 'opened:year', 'opened:never']);

        const added = await search(page,
            (s) => s.getFilterAutocompleteMatches('added:').map((m) => m.completion.trim()));
        expect(added).toEqual(['added:today', 'added:week', 'added:month', 'added:year']);

        // And they narrow as you type, like the status values do.
        const narrowed = await search(page,
            (s) => s.getFilterAutocompleteMatches('opened:w').map((m) => m.completion.trim()));
        expect(narrowed).toEqual(['opened:week']);
    });

    test('the filters still actually filter', async ({ page }) => {
        await openDashboard(page);
        const result = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            const now = Date.now();
            const fresh = { url: 'https://fresh.example', name: 'fresh', lastOpened: now, createdAt: now };
            const old = {
                url: 'https://old.example',
                name: 'old',
                lastOpened: now - 400 * 86400000,
                createdAt: now - 400 * 86400000,
            };
            const never = { url: 'https://never.example', name: 'never', lastOpened: 0, createdAt: now };
            return {
                freshWeek: s.matchesAdvancedFilters(fresh, { opened: 'week' }),
                oldWeek: s.matchesAdvancedFilters(old, { opened: 'week' }),
                neverNever: s.matchesAdvancedFilters(never, { opened: 'never' }),
                freshNever: s.matchesAdvancedFilters(fresh, { opened: 'never' }),
                freshAddedToday: s.matchesAdvancedFilters(fresh, { added: 'today' }),
                oldAddedToday: s.matchesAdvancedFilters(old, { added: 'today' }),
            };
        });

        expect(result).toEqual({
            freshWeek: true,
            oldWeek: false,
            neverNever: true,
            freshNever: false,
            freshAddedToday: true,
            oldAddedToday: false,
        });
    });
});
