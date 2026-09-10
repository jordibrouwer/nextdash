// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The finder line, once it is already open.
 *
 * "?" opens finders, and pressing it again added a second one. From there the
 * guard that swallows a lone space reads what follows the first "?" -- now "?"
 * rather than empty -- so spaces started landing in the query, and the whole
 * thing was searched for literally: "jordibrw.nl" became "??JORDIBRW.NL".
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const openFinders = (page) => page.evaluate(
    () => window.dashboardInstance.searchComponent._openInMode('?'),
);
const query = (page) => page.evaluate(
    () => window.dashboardInstance.searchComponent.currentQuery,
);

test.describe('the finder line', () => {
    test('a second ? is not typed into the query', async ({ page }) => {
        await openDashboard(page);
        await openFinders(page);
        expect(await query(page)).toBe('?');

        await page.keyboard.press('Shift+Slash');
        await page.waitForTimeout(250);

        // Already in finders: the key has nothing left to do.
        expect(await query(page)).toBe('?');
    });

    test('a search typed after ? keeps its spaces and carries no stray ?', async ({ page }) => {
        await openDashboard(page);
        await openFinders(page);

        await page.keyboard.press('Shift+Slash');
        await page.keyboard.type('jordibrw.nl');
        await page.keyboard.press('Space');
        await page.keyboard.type('test');
        await page.waitForTimeout(300);

        const q = await query(page);
        expect(q).not.toContain('??');
        // The space survived, so what follows is a search term and not one word.
        expect(q.toLowerCase()).toContain('jordibrw.nl test');
    });
});

/*
 * The overlay is built by the key that opens it, after the last render.
 *
 * SearchComponent handed its finders component an empty list and left the real
 * one to updateData(), which nothing calls between the bundle landing and the
 * first "?" — so straight after a load the line said "No finders set up yet"
 * with finders configured, and a shortcut typed after "?" never gained its
 * space, because there was no shortcut to complete against.
 */
test.describe('a freshly built overlay', () => {
    test('knows the finders the dashboard already has', async ({ page }) => {
        await openDashboard(page);
        const configured = await page.evaluate(() => (window.dashboardInstance.finders || []).length);
        expect(configured).toBeGreaterThan(0);

        // Built the way the loader builds it: a new component, and nothing
        // rendering between that and the key.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.searchComponent = null;
            d.initializeSearchComponent();
        });

        expect(await page.evaluate(() =>
            (window.dashboardInstance.searchComponent.findersComponent.finders || []).length)).toBe(configured);

        await openFinders(page);
        const matches = page.locator('#search-matches');
        await expect(matches).not.toContainText(/no finders/i, { timeout: 5000 });

        // And a shortcut typed after "?" completes, which is where the missing
        // space came from.
        const shortcut = await page.evaluate(() =>
            (window.dashboardInstance.finders || []).find((f) => f.shortcut)?.shortcut || '');
        await page.keyboard.type(shortcut);
        await page.waitForTimeout(300);
        expect(await query(page)).toBe(`?${shortcut.toUpperCase()} `);
    });
});

test.describe('the finder line with nothing set up', () => {
    test('says so, and offers the way to add one', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            const f = window.dashboardInstance.searchComponent.findersComponent;
            f.finders = [];
            f.shortcuts = new Map();
        });
        await openFinders(page);

        const matches = page.locator('#search-matches');
        await expect(matches).toContainText(/no finders/i, { timeout: 5000 });
        // Not the generic "no matches found", which offers to save what you
        // typed as a bookmark -- nothing was typed here.
        await expect(matches).not.toContainText(/no matches found/i);

        await page.evaluate(() => document.querySelector('.search-hint-entry')?.click());
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.config?._module?.ptTab), { timeout: 15_000 })
            .toBe('finders');
    });
});
