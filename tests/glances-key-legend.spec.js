// @ts-check
const { test, expect } = require('./fixtures');
const { mockGlances } = require('./helpers/glances-mock');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The Glances page's key legend works like the other views': sticky at the foot
 * of the window, Shift+H switches it, Shift+S the strip, and the cheat sheet
 * lists both.
 */

async function open(page) {
    await mockGlances(page);
    await page.setViewportSize({ width: 1400, height: 700 });
    await markWhatsNewSeen(page);
    await page.goto('/#glances/overview');
    await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-glances-legend]')).toBeVisible();
}

test('the legend names the page keys and the aids, and sticks to the foot of the window', async ({ page }) => {
    await open(page);
    const keys = await page.locator('[data-glances-legend] kbd').allInnerTexts();
    expect(keys.slice(-3)).toEqual(['?', 'Shift+H', 'Shift+S'].slice(0, 3));
    expect(keys).toContain('Shift+H');
    expect(keys).toContain('Shift+S');
    expect(await page.locator('[data-glances-legend]').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
});

test('Shift+H hides and shows the legend and says so', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Shift+H');
    await expect(page.locator('[data-glances-legend]')).toHaveCount(0);
    await expect(page.locator('.app-notification', { hasText: 'Key legend off' })).toBeVisible();
    expect(await page.evaluate(() => window.dashboardInstance.settings.glancesViewKeyLegend)).toBe('off');
    await page.keyboard.press('Shift+H');
    await expect(page.locator('[data-glances-legend]')).toBeVisible();
    expect(await page.evaluate(() => window.dashboardInstance.settings.glancesViewKeyLegend)).toBe('below');
});

test('above puts it over the page, and the strip names the mode', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.dashboardInstance.settings.glancesViewKeyLegend = 'above'; window.dashboardInstance.glances._module.sectionInstance?.placeLegend?.(); window.dashboardInstance.glances._module.placeLegend?.(); });
    const order = await page.evaluate(() => {
        const body = document.querySelector('[data-glances-body]');
        return [...body.children].map((el) => (el.matches('[data-glances-legend]') ? 'legend' : el.matches('.glances-section-host') ? 'host' : 'other')).filter((n) => n !== 'other');
    });
    expect(order[0]).toBe('legend');
    await page.keyboard.press('r');
    await expect(page.locator('#mode-strip')).toContainText('Browse');
});
