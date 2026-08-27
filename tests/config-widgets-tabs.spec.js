// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Widgets has a sub-tab strip, like every other section that edits something.
 *
 * It was the one screen in config without one, which reads as a page that has
 * not been finished. The second tab is not filler: the sentence describing
 * each kind already existed under the add form, where it is the right amount
 * while you are adding one and the wrong amount while you are choosing between
 * fourteen.
 */
async function openWidgets(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Quickstart's background favicon sweep reopens Overview when it finishes.
    await page.waitForTimeout(6000);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widgets-tab]').first()).toBeVisible();
}

test.describe('the Widgets section has tabs', () => {
    test('two of them, and the list is the one it opens on', async ({ page }) => {
        await openWidgets(page);
        await expect(page.locator('[data-widgets-tab]')).toHaveCount(2);
        await expect(page.locator('[data-widgets-tab="widgets"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
    });

    test('Types accounts for every kind, with none left ungrouped', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widgets-tab="types"]').click();

        /*
         * The grouping has to be exhaustive.
         *
         * A type that is offered but in no group is drawn nowhere and read by
         * nobody, and nothing else would notice: the picker and the reference
         * are both built from the groups, so it would go missing from both at
         * once. Compared against the register rather than a number, so adding
         * a type and forgetting to place it fails here.
         */
        const coverage = await page.evaluate(() => {
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.constructor;
            const grouped = (Config?.WIDGET_TYPE_GROUPS || []).flatMap(([, types]) => types);
            const offered = [...(Config?.WIDGET_TYPES || [])];
            return {
                missing: offered.filter((t) => t !== 'custom' && !grouped.includes(t)),
                strays: grouped.filter((t) => !offered.includes(t)),
                grouped: grouped.length,
            };
        });
        expect(coverage.missing).toEqual([]);
        expect(coverage.strays).toEqual([]);
        await expect(page.locator('.config-widget-type-row')).toHaveCount(coverage.grouped);

        // Custom is not one more row: it is a capability, and it gets the
        // section that explains what it can do.
        await expect(page.locator('.config-widget-custom-ref')).toBeVisible();
        await expect(page.locator('.config-widget-custom-point')).not.toHaveCount(0);
        // The list tab's door to the catalogue is not on this one.
        await expect(page.locator('[data-widget-catalogue]')).toHaveCount(0);
    });

    test('the tab reaches the address bar, so it can be linked to', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widgets-tab="types"]').click();
        // A section listed in SUB_TAB_STATE but not in SUB_TABS switches on
        // screen and never in the URL, which is the trap About fell into.
        await expect.poll(() => page.evaluate(() => window.location.hash))
            .toBe('#config/widgets/types');

        await page.locator('[data-widgets-tab="widgets"]').click();
        await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
    });
});
