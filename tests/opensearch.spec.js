// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The browser's address bar as a nextDash search box.
 *
 * Type the keyword, Tab, a term, Enter — no extension, no dashboard to open
 * first, no mouse. For a tool that is keyboard-first everywhere else this was
 * the one place it was not.
 *
 * Two halves: an address a search can live at, and a description telling the
 * browser about it. The address had to be built first — every other view has
 * one, and search did not.
 */

test.describe('searching from the address bar', () => {
    test('the description names this install and points at the search route', async ({ page }) => {
        const res = await page.request.get('/opensearch.xml');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('opensearchdescription+xml');

        const xml = await res.text();
        // The namespace is required; a browser refuses the document without it.
        expect(xml).toContain('xmlns="http://a9.com/-/spec/opensearch/1.1/"');
        expect(xml).toContain('<ShortName>');
        // {searchTerms} is the one placeholder every browser substitutes, and
        // the template has to be absolute — a relative one is refused.
        expect(xml).toMatch(/template="https?:\/\/[^"]+\/#search\?q=\{searchTerms\}"/);
    });

    test('the page offers itself to the browser', async ({ page }) => {
        await page.goto('/');
        const link = page.locator('link[rel="search"]');
        await expect(link).toHaveAttribute('type', 'application/opensearchdescription+xml');
        await expect(link).toHaveAttribute('href', '/opensearch.xml');
        // The title is what appears beside the keyword; an empty one leaves the
        // browser to invent a name.
        const title = await link.getAttribute('title');
        expect((title || '').length).toBeGreaterThan(0);
    });

    /*
     * The arrival case, and the one that matters most.
     *
     * A search reached from the address bar is always a fresh page, and
     * restoring the bookmarks view rewrites the hash to the page number during
     * bootstrap — so the query has to be read before anything else runs.
     */
    test('arriving on a query runs it', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#search?q=github');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);

        await expect.poll(async () => page.evaluate(() => ({
            query: window.dashboardInstance?.searchComponent?.currentQuery,
            active: window.dashboardInstance?.searchComponent?.searchActive,
        })), { timeout: 15_000 }).toEqual({ query: 'github', active: true });
    });

    test('a query changed in the address runs too', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await page.evaluate(() => { window.location.hash = 'search?q=youtube'; });
        await expect.poll(async () => page.evaluate(() =>
            window.dashboardInstance?.searchComponent?.currentQuery),
        { timeout: 15_000 }).toBe('youtube');
    });

    // An address with no term still means "open search", which is what the
    // palette does with an empty query anyway.
    test('an empty query opens search rather than nothing', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#search');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);

        await expect.poll(async () => page.evaluate(() =>
            window.dashboardInstance?.searchComponent?.searchActive),
        { timeout: 15_000 }).toBe(true);
    });
});
