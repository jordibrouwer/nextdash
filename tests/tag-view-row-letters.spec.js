// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The tag view speaks the dashboard's way: plain letters on the row under the
 * cursor, Shift only for views. The legend lists them and Shift+H switches it; the
 * mode strip follows the cursor and hides for the mouse.
 */
async function openTagView(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('Shift+T');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 }).toBe('tags');
    await expect(page.locator('.tag-view-row').first()).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
        window.__acts = [];
        const cm = window.dashboardInstance.contextMenu;
        const real = cm.load.bind(cm);
        cm.load = async () => { const menu = await real(); const run = menu.runAction.bind(menu); menu.runAction = (a, ...rest) => { window.__acts.push(a); }; return menu; };
    });
}

test('letters run the row actions, and Shift+letter runs none', async ({ page }) => {
    await openTagView(page);
    await page.keyboard.press('j');
    for (const k of ['p', 't', 'm', 'c', 's', 'q', 'r', 'w', 'd']) await page.keyboard.press(k);
    await expect.poll(() => page.evaluate(() => window.__acts)).toEqual(
        ['pin', 'tags', 'move', 'check-mode', 'share', 'qr', 'health', 'feed-watch', 'delete']);
    await page.evaluate(() => { window.__acts = []; });
    for (const k of ['Shift+P', 'Shift+M', 'Shift+D', 'Shift+S', 'Shift+Q']) await page.keyboard.press(k);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__acts)).toEqual([]);
});

test('Ctrl+Enter opens the row in a new tab', async ({ page }) => {
    await openTagView(page);
    await page.keyboard.press('j');
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => page.evaluate(() => window.__acts)).toContain('open-new-tab');
});

test('the legend lists the letters and Shift+H switches it', async ({ page }) => {
    await openTagView(page);
    const legend = page.locator('.tag-view-legend');
    await expect(legend).toBeVisible();
    for (const k of ['j / k', 't', 'm', 'p', 'd', 'Ctrl/Cmd+Enter', 'Shift+H']) {
        await expect(legend.locator('kbd', { hasText: new RegExp(`^${k.replace(/[/+]/g, '\\$&')}$`) })).toHaveCount(1);
    }
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.tag-view-legend')).toHaveCount(0);
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.tag-view-legend')).toBeVisible();
});

test('the legend stays in view at the foot of the window', async ({ page }) => {
    await openTagView(page);
    const legend = page.locator('.tag-view-legend');
    await expect(legend).toBeInViewport();
});

test('the mode strip follows the cursor, hides for the mouse and returns with a key', async ({ page }) => {
    await openTagView(page);
    const strip = page.locator('#mode-strip');
    await page.keyboard.press('j');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Cursor');
    await page.mouse.click(8, 8);
    await expect(strip).toBeHidden();
    await page.keyboard.press('j');
    await expect(strip).toBeVisible();
});

test('Shift+H switches the legend with a dropdown focused, but types in the search field', async ({ page }) => {
    await openTagView(page);
    await page.locator('.tag-view select').first().focus();
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.tag-view-legend')).toHaveCount(0);
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.tag-view-legend')).toBeVisible();
    await page.keyboard.press('/');
    await page.keyboard.type('H');
    await expect(page.locator('.tag-view-legend')).toBeVisible();
});
