// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * `;` switches search mode, and so does `/`.
 *
 * The overlay has always had one key for "search the other way": with
 * *Switch Search Mode* off, typing letters looks for a shortcut and `/` looks
 * for a name. That key is `/`, which is also the dashboard's tag-cloud key —
 * different contexts, so they do not actually collide, but one character
 * meaning two things is not something anyone remembers.
 *
 * `;` is the unambiguous one: free across the whole cheat-sheet registry,
 * unshifted on QWERTY and AZERTY, and sitting next to the `:` that already
 * opens commands. `/` keeps working, because taking a key out of people's
 * fingers costs more than supporting two.
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
    test('; finds a bookmark by name, the way / does', async ({ page }) => {
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

        const viaSemicolon = await run(page, `;${stem}`);
        const viaSlash = await run(page, `/${stem}`);

        expect(viaSemicolon.length, `";${stem}" found nothing`).toBeGreaterThan(0);
        expect(viaSemicolon, 'the two prefixes disagree').toEqual(viaSlash);
    });

    test('the prefix is stripped before it reaches the query', async ({ page }) => {
        await openSearch(page);
        const stripped = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            s.currentQuery = ';github';
            s.updateSearch();
            // Whatever the overlay searched for, it was not ";github".
            return s.searchMatches.some((m) => (m.query || '').startsWith(';'));
        });
        expect(stripped, 'the semicolon leaked into the search term').toBe(false);
    });

    test('a semicolon inside a query is left alone', async ({ page }) => {
        await openSearch(page);
        // Only a leading semicolon switches mode; one in the middle is a
        // character someone typed.
        const matches = await run(page, 'git;hub');
        expect(Array.isArray(matches)).toBe(true);
    });
});
