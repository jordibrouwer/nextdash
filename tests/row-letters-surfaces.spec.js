// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/** The text surfaces name the plain letters: legend line, right-click menu, tour copy. */

async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
}

test('the legend line for the bookmark shows e m t p and Esc', async ({ page }) => {
    await load(page);
    await page.keyboard.press('ArrowDown');
    const legend = page.locator('.dashboard-key-legend, #dashboard-key-legend, .dashboard-legend').first();
    await expect(legend).toContainText('to search', { timeout: 5000 });
    const keys = await page.evaluate(() => window.KeyboardViewLegends.DASHBOARD_VIEW.filter((r) => r.line === 4 && !r.more).map((r) => r.keys));
    expect(keys).toEqual(expect.arrayContaining(['e', 'm', 't', 'p', 'Esc']));
});

test('the right-click menu of a bookmark shows plain-letter hints, none with Shift', async ({ page }) => {
    await load(page);
    await page.locator('.bookmark-link').first().click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await expect(menu).toBeVisible({ timeout: 5000 });
    const text = await menu.innerText();
    expect(text).not.toMatch(/Shift\s*\+\s*[A-Z]\b/);
    const chips = await menu.locator('kbd, .context-menu-key, .menu-key').allInnerTexts();
    for (const k of ['E', 'M', 'T', 'P', 'S', 'Q']) expect(chips.map((c) => c.trim())).toContain(k);
});

test('the dashboard tour names plain letters for a bookmark', async ({ page }) => {
    await load(page);
    const body = await page.evaluate(() => window.dashboardInstance?.language?.t?.('dashboard.dashTour4KeysBody2') || '');
    expect(body).toMatch(/plain letters/);
    expect(body).not.toMatch(/Shift plus a letter/);
});
