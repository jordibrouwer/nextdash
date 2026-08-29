// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * How far it is from the heading to the first bookmark.
 *
 * Six things stood between them — a subtitle, ten summary tiles, fifteen filter
 * pills, a search row, up to eleven action buttons, and a sentence — so on a
 * laptop the first row of a list about bookmarks began below the fold. The
 * tiles and the pills were largely the same figures twice over, the cards being
 * the expensive copy.
 *
 * The report is supplied rather than seeded: these are measurements in pixels,
 * and a list whose length depends on what earlier specs left behind measures
 * something different every run.
 */
const REPORT = {
    generatedAt: Date.now(),
    summary: { total: 4, healthyCount: 2, brokenCount: 1, staleCount: 1 },
    certificates: { 'cert.example.com': { expiresAt: Date.now() + 5 * 86400000, issuer: 'Test CA' } },
    issues: [
        { pageId: 1, index: 0, name: 'Healthy one', url: 'https://a.example.com/',
          certHost: 'cert.example.com', status: 'healthy', flags: ['healthy'], score: 100, lastChecked: Date.now() },
        { pageId: 1, index: 1, name: 'Healthy two', url: 'https://b.example.com/',
          status: 'healthy', flags: ['healthy'], score: 100, lastChecked: Date.now() },
        { pageId: 1, index: 2, name: 'Broken one', url: 'https://c.example.com/',
          status: 'broken', flags: ['broken'], score: 10, lastChecked: Date.now() },
        { pageId: 1, index: 3, name: 'Stale one', url: 'https://d.example.com/',
          status: 'stale', flags: ['stale'], score: 60, lastChecked: Date.now() - 400 * 86400000 },
    ],
};

async function openHealth(page) {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(REPORT),
    }));
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#health');
    await page.waitForSelector('.health-view-tiles', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('the tiles read as one line, not a wall of cards', async ({ page }) => {
    await openHealth(page);

    const tiles = page.locator('.health-view-tiles');
    await expect(tiles).toBeVisible();

    const height = await tiles.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(height, `tile strip is ${height}px tall`).toBeLessThan(48);

    // Still a way in: every figure that carried a filter keeps it.
    expect(await page.locator('[data-health-tile]').count()).toBeGreaterThan(3);
});
