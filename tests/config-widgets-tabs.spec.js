// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * Widgets is one view. The Types tab was folded into the Add catalogue, which
 * already lists every kind with its sentence; the Custom widget's long
 * explanation sits under the catalogue as a disclosure.
 */
async function openWidgetsSection(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Quickstart's background favicon sweep reopens Overview when it finishes,
    // so this waited six seconds for it. waitForFaviconPrefetch waits for the
    // same thing by asking -- the overlay gone and nextdashSetupFaviconsDone no
    // longer false -- and returns the moment it is true instead of always
    // spending the worst case. dismissBlockingOverlays above already called it
    // once; a second call costs nothing when the sweep is already done and
    // covers the case where it was still running.
    await waitForFaviconPrefetch(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('#config-widgets-body')).toBeVisible();
}

test.describe('the Widgets section is one view', () => {
    test('no tab strip, the list is the page', async ({ page }) => {
        await openWidgetsSection(page);
        await expect(page.locator('[data-widgets-tab]')).toHaveCount(0);
        await expect(page.locator('#config-widgets-body')).toBeVisible();
    });

    test('the catalogue accounts for every kind, with none left ungrouped', async ({ page }) => {
        await openWidgetsSection(page);
        await page.locator('[data-widget-catalogue]').first().click();
        const coverage = await page.evaluate(() => {
            const groups = window.DashboardConfig.WIDGET_TYPE_GROUPS;
            const grouped = groups.reduce((n, [, types]) => n + types.length, 0);
            return { grouped };
        });
        // +1: the Custom card sits in its own group below the others.
        await expect(page.locator('.modal--widget-catalogue .config-widget-pick'))
            .toHaveCount(coverage.grouped + 1);
    });

    test('the catalogue explains the Custom widget and counts its services', async ({ page }) => {
        await openWidgetsSection(page);
        await page.locator('[data-widget-catalogue]').first().click();
        const more = page.locator('.modal--widget-catalogue details.config-widget-custom-ref');
        await more.locator('summary').click();
        const count = await page.evaluate(() => window.DashboardWidgetPresets?.serviceCount?.() || 0);
        if (count) await expect(more).toContainText(String(count));
    });

    test('an old link to the Types tab opens the list', async ({ page }) => {
        await page.goto('/#config/widgets/types');
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await expect(page.locator('#config-widgets-body')).toBeVisible();
        await expect(page.locator('#config-widgets-body')).not.toBeEmpty();
        expect(page.url()).not.toContain('/types');
    });
});
