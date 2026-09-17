// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The settings a reader changes often, each on its own word in the palette.
 *
 * `:buttons` says which action buttons are drawn; `:action` says where the bar
 * they stand in is and how it behaves there — the settings this release moved.
 * The rest are the same two-to-five-answer choices config draws as cards.
 */

async function palette(page, typed) {
    // Leave whatever is open: the palette stays up after a command, and a
    // second `:` would be typed into the query rather than opening it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.press(':');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.type(typed);
    await page.waitForTimeout(250);
}

async function open(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const rows = (page) => page.locator('.search-match');

test(':action names the five places, with the current one ticked', async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
        window.dashboardInstance.settings.actionBarPosition = 'right';
        await window.dashboardInstance.saveSettings?.();
    });
    await palette(page, 'action');

    await expect(rows(page)).toHaveCount(5);
    const ticked = await page.locator('.search-match', { hasText: '✓' }).first().textContent();
    expect(ticked).toContain('right');
});

test(':action bottom moves the bar, and it is saved', async ({ page }) => {
    await open(page);
    await palette(page, 'action bottom');
    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(() => document.body.dataset.actionBar), { timeout: 5_000 }).toBe('bottom');
    const saved = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).actionBarPosition);
    expect(saved).toBe('bottom');
});

test(':action hide sets the delay, and :action keys the chips', async ({ page }) => {
    await open(page);
    await palette(page, 'action hide 10');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.settings.actionBarAutoHideSeconds), { timeout: 5_000 }).toBe(10);

    await palette(page, 'action keys off');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.body.dataset.actionKeys), { timeout: 5_000 }).toBe('off');
});
