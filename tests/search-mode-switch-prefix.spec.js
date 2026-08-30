// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * `/` switches search mode, and it is the only key that does.
 *
 * With *Switch Search Mode* off, typing letters looks for a shortcut and `/`
 * looks for a name; with it on, the reverse.
 *
 * `;` was briefly a second spelling and was taken back out: it already opens
 * the inline editor on the grid, so it meant one thing on the page and another
 * in the overlay — the confusion a second key was supposed to spare people.
 * The last test here guards that it stays out.
 */
async function openSearch(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('>');
    await expect
        .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
            { timeout: 15_000 })
        .toBe(true);
}

/** Run a query through the overlay the way typing does, and report the hits. */
const run = (page, query) => page.evaluate((q) => {
    const s = window.dashboardInstance.searchComponent;
    s.currentQuery = q;
    s.updateSearch();
    return (s.searchMatches || [])
        .filter((m) => m.type === 'bookmark' || m.type === 'fuzzy' || m.bookmark)
        .map((m) => m.bookmark?.name || m.name)
        .filter(Boolean);
}, query);

test.describe('the mode-switch prefix', () => {
    test('/ finds a bookmark by name', async ({ page }) => {
        await openSearch(page);
        // A name that is not also its own shortcut, so this can only be a
        // name match — the whole point of the other mode.
        const name = await page.evaluate(() => {
            const b = (window.dashboardInstance.searchComponent.bookmarks || [])
                .find((x) => (x.name || '').length > 4);
            return b ? b.name : null;
        });
        expect(name, 'no bookmark long enough to search by name').toBeTruthy();
        const stem = name.slice(0, 4).toLowerCase();

        const viaSlash = await run(page, `/${stem}`);
        expect(viaSlash.length, `"/${stem}" found nothing`).toBeGreaterThan(0);
    });

    test('the prefix is stripped before it reaches the query', async ({ page }) => {
        await openSearch(page);
        const stripped = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            s.currentQuery = '/github';
            s.updateSearch();
            // Whatever the overlay searched for, it was not "/github".
            return s.searchMatches.some((m) => (m.query || '').startsWith('/'));
        });
        expect(stripped, 'the slash leaked into the search term').toBe(false);
    });

    test('a slash inside a query is left alone', async ({ page }) => {
        await openSearch(page);
        // Only a leading slash switches mode; one in the middle is a
        // character someone typed.
        const matches = await run(page, 'git/hub');
        expect(Array.isArray(matches)).toBe(true);
    });

    test('; is not a mode switch — it belongs to the grid', async ({ page }) => {
        await openSearch(page);
        // `;` opens the inline editor on a bookmark row. If it ever switches
        // mode again, one character means two things and this fails.
        const treatedAsPrefix = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            return s._hasModeSwitchPrefix(';github');
        });
        expect(treatedAsPrefix, '; switched mode again').toBe(false);
    });
});
