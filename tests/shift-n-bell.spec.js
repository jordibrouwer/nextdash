// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Shift+N opens the notification center, the bell, and closes it again. It was
 * the news; the news is Shift+W now (tests/feed-watch-keys.spec.js).
 */
async function loadDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.activeElement?.blur());
}

const panel = (page) => page.locator('.notification-bell-panel');
const isOpen = (page) => page.locator('.notification-bell-button[aria-expanded="true"]').count();

test('Shift+N opens the bell, and again closes it', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Shift+N');
    await expect.poll(() => isOpen(page)).toBe(1);
    await page.keyboard.press('Shift+N');
    await expect.poll(() => isOpen(page)).toBe(0);
});

test('Shift+N opens the bell with no feed watched', async ({ page }) => {
    await loadDashboard(page);
    expect(await page.evaluate(() => window.dashboardInstance?.feedWatch?.byKey?.size || 0)).toBe(0);
    await page.keyboard.press('Shift+N');
    await expect.poll(() => isOpen(page)).toBe(1);
    await expect(panel(page)).toBeVisible();
});

test('Shift+N typed in a text field opens nothing', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe-field';
        document.body.appendChild(input);
        input.focus();
    });
    await page.keyboard.press('Shift+N');
    await expect(page.locator('#probe-field')).toHaveValue('N');
    expect(await isOpen(page)).toBe(0);
});
