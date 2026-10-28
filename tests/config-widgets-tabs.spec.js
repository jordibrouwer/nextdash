// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen,
} = require('./e2e-helpers');

/**
 * Widgets is one list with one tab, like Finders. Adding is the picker (the
 * Add wizard); the old Catalogue and Custom widget tabs are gone, and links
 * that named them open the wizard instead of a tab that no longer exists.
 */
async function openWidgetsSection(page, { widgets = [] } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Quickstart's background favicon sweep reopens Overview when it finishes;
    // this returns the moment that sweep is done.
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const dash = window.dashboardInstance;
        await f(`/api/pages/${dash.pages[0].id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: list }) });
        await dash.config.openConfigView('widgets');
    }, widgets);
    await expect(page.locator('#config-widgets-body')).toBeVisible();
}

const picker = (page) => page.locator('.config-widget-picker');
const customScreen = (page) =>
    page.locator('[data-widget-wizard-screen="connect"][data-type="custom"]');

test.describe('the Widgets section is one list', () => {
    test('one tab, Your widgets', async ({ page }) => {
        await openWidgetsSection(page);
        await expect(page.locator('[data-widgets-tab]')).toHaveCount(1);
        await expect(page.locator('[data-widgets-tab]')).toHaveText('Your widgets');
        await expect(page.locator('[data-widgets-tab="catalogue"]')).toHaveCount(0);
        await expect(page.locator('[data-widgets-tab="custom"]')).toHaveCount(0);
        await expect(page).toHaveURL(/#config\/widgets$/);
    });

    test('the Add button in the empty list opens the picker', async ({ page }) => {
        await openWidgetsSection(page);
        await page.locator('[data-widget-catalogue]').first().click();
        await expect(picker(page)).toHaveCount(1);
        await expect(page.locator('[data-widget-search]')).toBeVisible();
    });
});

test.describe('old links open the wizard', () => {
    for (const name of ['catalogue', 'types']) {
        test(`#config/widgets/${name} opens the picker`, async ({ page }) => {
            await markWhatsNewSeen(page);
            await page.goto(`/#config/widgets/${name}`);
            await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
            await expect(picker(page)).toHaveCount(1);
            await expect(page.locator('[data-widget-search]')).toBeVisible();
            await expect(page.locator('[data-widgets-tab]')).toHaveCount(1);
            // Not a dead address: the bar says where the list is.
            await expect(page).toHaveURL(/#config\/widgets$/);
        });
    }

    test('#config/widgets/custom opens the custom connect screen once', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/widgets/custom');
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await expect(customScreen(page)).toBeVisible();
        // The same link again, as a second visit to the section.
        await page.goto('/#config/widgets/custom');
        await expect(customScreen(page)).toHaveCount(1);
        await expect(page.locator('#modal-text .config-widget-wizard')).toHaveCount(1);
    });

    test('a wizard opened by a link and closed stays closed', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/widgets/custom');
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await expect(customScreen(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(customScreen(page)).toHaveCount(0);
        // A repaint of the section binds it again; that must not reopen it,
        // even with the old address still in the bar.
        await page.evaluate(() => {
            history.replaceState(history.state, '', '#config/widgets/custom');
            window.dashboardInstance.config.repaintWidgetsBody();
        });
        await expect(page.locator('#modal-text .config-widget-wizard')).toHaveCount(0);
        await expect(picker(page)).toHaveCount(0);
    });
});
