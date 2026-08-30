// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A query that arrives from outside is searched by name.
 *
 * The overlay has two modes, and which one a bare query gets is a setting:
 * with *Switch Search Mode* off — the default — typing letters looks for a
 * bookmark *shortcut*, and a name needs a `/` or `;` in front.
 *
 * That is a fair bargain while you are typing, because you can still press the
 * prefix. It is the wrong one for a query that arrives already written: the
 * address bar (nextDash registers an OpenSearch engine pointing at
 * `/#search?q={searchTerms}`), a deep link, a shared URL. Nobody types
 * "mediacourant" into their address bar hoping to match a two-letter shortcut,
 * and the failure is silent — the overlay opens on a query the reader cannot
 * revise and says nothing was found.
 *
 * So an arrived query is matched both ways. An exact shortcut still leads the
 * list, because it is the strongest signal there is; the name matches follow
 * instead of being absent.
 */
async function arriveWith(page, query) {
    await markWhatsNewSeen(page);
    await page.goto(`/#search?q=${encodeURIComponent(query)}`);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect
        .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
            { timeout: 15_000 })
        .toBe(true);
    return page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        return {
            query: s.currentQuery,
            names: (s.searchMatches || []).map((m) => m.bookmark?.name || m.name).filter(Boolean),
            shortcuts: (s.searchMatches || []).map((m) => m.shortcut).filter(Boolean),
        };
    });
}

test('a name typed in the address bar finds its bookmark', async ({ page }) => {
    // A name long enough that it cannot also be its own shortcut.
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    const name = await page.evaluate(() => {
        const b = (window.dashboardInstance?.bookmarks || []).find((x) => (x.name || '').length > 5);
        return b ? b.name : null;
    });
    expect(name, 'no bookmark with a long enough name to test with').toBeTruthy();

    const result = await arriveWith(page, name);
    expect(result.query).toBe(name);
    expect(result.names, `arriving with "${name}" found nothing`).toContain(name);
});

test('an exact shortcut still leads the list', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    const pick = await page.evaluate(() => {
        const b = (window.dashboardInstance?.bookmarks || []).find((x) => (x.shortcut || '').trim());
        return b ? { shortcut: b.shortcut, name: b.name } : null;
    });
    test.skip(!pick, 'no bookmark carries a shortcut in this fixture');

    const result = await arriveWith(page, pick.shortcut);
    expect(result.names.length, 'the shortcut found nothing at all').toBeGreaterThan(0);
    // First, not merely present: an exact shortcut is the strongest signal.
    expect(result.names[0]).toBe(pick.name);
});

test('typing in the overlay still respects the mode setting', async ({ page }) => {
    // The change is scoped to arrived queries. Someone typing can still press
    // the prefix, so their setting keeps deciding — otherwise this would be a
    // silent behaviour change for every existing install.
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    const typed = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.interleaveMode = false;               // shortcut-first, the default
        const long = (window.dashboardInstance.bookmarks || [])
            .find((b) => (b.name || '').length > 5);
        s.currentQuery = long.name;
        s.updateSearch();
        return {
            name: long.name,
            matches: (s.searchMatches || []).map((m) => m.bookmark?.name).filter(Boolean),
        };
    });
    expect(typed.matches, 'typing now behaves like an arrived query, which was not the intent')
        .not.toContain(typed.name);
});
