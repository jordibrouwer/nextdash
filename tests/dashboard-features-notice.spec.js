// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The corner card that points at the feature overview on nextdash.cc. It waits
 * until the dashboard has a handful of bookmarks, opens the page in a new tab,
 * and an answer either way is final -- until Config says Show again.
 */

const PROMO_ID = 'features-overview-v1';

async function load(page) {
    await markWhatsNewSeen(page);
    // The site is not this test's business: the new tab is answered locally.
    await page.context().route('https://nextdash.cc/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>features</title>' }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false }), PROMO_ID);
}

test('See all features opens the overview in a new tab and is not asked again', async ({ page, context }) => {
    await load(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.allBookmarks = Array.from({ length: 10 }, (_, i) => ({ name: `b${i}`, url: `https://b${i}.example/` }));
    });
    expect(await page.evaluate(() => window.DashboardFeaturesNotice.shouldShow())).toBe(true);
    expect(await page.evaluate(() => window.DashboardFeaturesNotice.render())).toBe(true);
    const card = page.locator('.features-notice-card');
    await expect(card).toBeVisible();

    const [tab] = await Promise.all([
        context.waitForEvent('page'),
        card.locator('[data-features-action="open"]').click(),
    ]);
    await tab.waitForLoadState();
    expect(tab.url()).toBe('https://nextdash.cc/features/');
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => window.DashboardFeaturesNotice.shouldShow())).toBe(false);
});

test('it waits for a dashboard with a handful of bookmarks', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.allBookmarks = [{ name: 'one', url: 'https://one.example/' }];
        d.bookmarks = d.bookmarks.slice(0, 1);
    });
    expect(await page.evaluate(() => window.DashboardFeaturesNotice.shouldShow())).toBe(false);
});

test('No thanks is final, and Config can bring it back', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window.dashboardInstance.allBookmarks = Array.from({ length: 10 }, (_, i) => ({ name: `b${i}`, url: `https://b${i}.example/` }));
        window.DashboardFeaturesNotice.render();
    });
    await page.locator('.features-notice-card .quickstart-btn[data-features-action="dismiss"]').click();
    await expect(page.locator('.features-notice-card')).toHaveCount(0);
    expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.locator('[data-behavior-tab="privacy"]').click();
    const replay = page.locator('[data-notice-card="features"]');
    await expect(replay).toBeEnabled();
    await replay.click();
    await expect.poll(() => page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(false);
});
