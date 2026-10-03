// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Your own themes stand out among three hundred: a badge, a segment, a block
 * of their own at the top of the grid, and a group of their own in the picker.
 */

async function ready(page) {
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
}

async function withOwnTheme(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await ready(page);
    await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        const c = await (await fetch('/api/colors')).json();
        c.custom = { 'theme-yours-1': { ...c.dark, name: 'Zebra Mine' } };
        await cfg.writeFetch('/api/colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
    });
    // A fresh page, so nothing holds the theme list from before.
    await page.reload();
    await ready(page);
}

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 15_000 });
}

test('the theme browser marks and groups your own themes', async ({ page }) => {
    await withOwnTheme(page);
    await openStudio(page);
    const card = page.locator('[data-theme-card][data-theme-id="theme-yours-1"]');
    await expect(card.locator('[data-theme-yours]')).toBeVisible();
    // Under All, first, under its own heading, although "Zebra" sorts last.
    await expect(page.locator('[data-theme-grid] [data-theme-card]').first()).toHaveAttribute('data-theme-id', 'theme-yours-1');
    await expect(page.locator('[data-theme-group="yours"]')).toBeVisible();
    await page.locator('[data-theme-segment="yours"]').click();
    await expect(page.locator('[data-theme-grid] [data-theme-card]')).toHaveCount(1);
    await page.locator('[data-theme-segment="all"]').click();
    await page.locator('[data-theme-search]').fill('yours');
    await expect(page.locator('[data-theme-grid] [data-theme-card]')).toHaveCount(1);
});

test('the Appearance picker lists your themes in a group of their own, first', async ({ page }) => {
    await withOwnTheme(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.locator('[data-theme-picker-button]').click();
    const groups = page.locator('[data-theme-picker-list] [data-theme-picker-group]');
    await expect(groups.first()).toHaveAttribute('data-theme-picker-group', 'yours');
    await expect(groups.first().locator('[data-theme-option="theme-yours-1"]')).toBeVisible();
});
