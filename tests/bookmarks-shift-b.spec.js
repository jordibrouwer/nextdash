// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Shift+B opens the Bookmarks view the way its header button does: the whole
 * list, no Health filter and nothing selected. Shift+H, its old key, is the key
 * legend now. The add form is
 * on +, & and Ctrl+Shift+A; Shift+B no longer opens it.
 */
async function loadDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.activeElement?.blur());
}

test('Shift+B opens the whole Bookmarks list, as the header button does', async ({ page }) => {
    await loadDashboard(page);

    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });

    const state = await page.evaluate(() => ({
        hash: window.location.hash,
        selected: document.querySelectorAll('#config-bm-list .config-bm-row.is-selected, #config-bm-list .config-bm-row[aria-selected="true"]').length,
    }));
    expect(state.hash).not.toMatch(/health=/);
    expect(state.selected).toBe(0);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
});

test('Shift+B typed in a text field opens nothing', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe-field';
        document.body.appendChild(input);
        input.focus();
    });
    await page.keyboard.press('Shift+B');
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('library');
    await expect(page.locator('#probe-field')).toHaveValue('B');
});

test('Shift+H no longer opens the Bookmarks view: it is the key legend', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => { window.dashboardInstance.saveSettings = async () => true; });
    await page.keyboard.press('Shift+H');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
});

test('Ctrl+Shift+A still opens the add form', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Control+Shift+A');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
});

test('Shift+B leaves Config for the Bookmarks view', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press(',');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
});

test('Shift+B from Config opens the whole list, not the Broken filter', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press(',');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    expect(await page.evaluate(() => window.location.hash)).not.toMatch(/health=/);
});

test('Shift+B inside the Bookmarks view keeps the filter the reader has', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
    await page.evaluate(() => { window.location.hash = '#bookmarks?health=stale'; });
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.location.hash);
    await page.keyboard.press('Shift+B');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.location.hash)).toBe(before);
});
