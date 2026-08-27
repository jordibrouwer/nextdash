// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * `:config <section>` names the config that exists, and arrives at it.
 *
 * It listed the config of two rewrites ago — General settings, Theme & colors,
 * Pages, Categories, Tags, Finders, Collections — of which none is a section
 * any more, and it did not offer Overview, Appearance, Behavior, Widgets or
 * About at all.
 *
 * Worse, every row landed in the same place. The action was
 * `location.href = '/config#<id>'`, and `/config` is the pre-v1.3 page that now
 * answers 302 to `/#config`: a redirect whose target carries its own fragment
 * replaces the one that was asked for, so the section was dropped and all
 * eleven rows opened Overview — after a full page load of a view that lives in
 * the same page.
 */

const PROMO_KEYS = [
    'nextdash:dashboard-quick-tag-promo-confirmed-v1',
    'nextdash:dashboard-search-promo-command-v1',
];

async function loadDashboard(page) {
    await markWhatsNewSeen(page, { extraPromoConfirmedKeys: PROMO_KEYS });
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
    await page.keyboard.press('Escape');
}

/** Type a command and hand back what the palette offers for it. */
async function offer(page, typed) {
    await page.keyboard.press(':');
    await page.keyboard.type(typed, { delay: 15 });
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.searchComponent.selectableMatches || []).length),
    { timeout: 5000 }).toBeGreaterThan(0);
    return page.evaluate(() =>
        (window.dashboardInstance.searchComponent.selectableMatches || []).map((m) => m.name));
}

test.describe('the config commands name the config that exists', () => {
    test('every section in the rail is offered', async ({ page }) => {
        await loadDashboard(page);
        const names = await offer(page, 'config');

        // Compared against the module's own list rather than a copy of it, so a
        // section added later fails here instead of quietly going unoffered.
        const sections = await page.evaluate(() =>
            [...(window.DashboardConfig?.SECTIONS || window.DashboardConfigLoader.SECTIONS)]);
        expect(sections.length).toBeGreaterThan(0);

        const labels = {
            overview: 'Overview', bookmarks: 'Bookmarks', appearance: 'Appearance',
            'pages-tags': 'Pages & tags', behavior: 'Behavior',
            'data-backups': 'Data & backups', widgets: 'Widgets', stats: 'Statistics',
            help: 'Help', about: 'About',
        };
        for (const id of sections) {
            expect(names, `section ${id} is not offered`).toContain(labels[id]);
        }
        // And nothing from the config that no longer exists.
        expect(names).not.toContain('Theme & colors');
        expect(names).not.toContain('Collections');
    });

    test('a section command opens that section, in place', async ({ page }) => {
        await loadDashboard(page);
        const before = page.url();

        await offer(page, 'config widgets');
        await page.keyboard.press('Enter');

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance?.config?.section), { timeout: 10_000 }).toBe('widgets');
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        // Same document: config is a view here, not a page to navigate to.
        expect(page.url().split('#')[0]).toBe(before.split('#')[0]);
    });

    test('a name that became a sub-tab still arrives at it', async ({ page }) => {
        await loadDashboard(page);

        await offer(page, 'config categories');
        await page.keyboard.press('Enter');

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance?.config?.section), { timeout: 10_000 }).toBe('pages-tags');
        expect(await page.evaluate(() => window.dashboardInstance.config.ptTab)).toBe('categories');
    });
});
