// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Acting on a row leaves you at that row.
 *
 * Saving a copy reloads the report, and the health view rebuilds its whole list
 * on a render — so the page went back to the top and the reader had to find
 * their place again, having done nothing but act on the row in front of them.
 */

async function openHealthList(page) {
    // Short enough that a row a little way down is genuinely below the fold.
    await page.setViewportSize({ width: 1200, height: 620 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.DiscoverabilityState?.markSettingPromoSeen?.('health-filter-scroll-v1');
    });
    await page.evaluate(async () => {
        const health = window.dashboardInstance.health;
        await health.openHealthView();
        health.filter = 'all';
        health.render();
        health.stopLiveRefresh?.();
    });
    await expect(page.locator('.health-view-item').first()).toBeVisible({ timeout: 15_000 });
}

test('saving a copy leaves the row where the reader was', async ({ page }) => {
    await openHealthList(page);
    // The capture itself is not what this tests; it is what happens after.
    await page.route('**/api/archives/capture**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ path: 'data/archives/x.html', bytes: 1234, url: '/api/archives/x.html', at: Date.now() }),
    }));

    // A row well down the list, reached the way a reader reaches it.
    const row = page.locator('.health-view-item').nth(6);
    await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({
        y: Math.round(window.scrollY),
        rowTop: Math.round(document.querySelectorAll('.health-view-item')[6].getBoundingClientRect().top),
    }));
    // A test that starts at the top of the list proves nothing.
    expect(before.y).toBeGreaterThan(150);

    await row.evaluate((el) => el.querySelector('.health-view-more-btn')?.click());
    await page.evaluate(() => document
        .querySelector('.health-view-menu[data-menu-owner="more"] [data-menu-action="local-copy"]')
        ?.click());
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => ({
        y: Math.round(window.scrollY),
        rowTop: Math.round(document.querySelectorAll('.health-view-item')[6]?.getBoundingClientRect().top ?? NaN),
    }));
    expect(after.y, `scrolled from ${before.y} to ${after.y}`).toBeGreaterThan(before.y - 150);
});
