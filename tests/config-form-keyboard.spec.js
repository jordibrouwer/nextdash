// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

async function openSection(page, section) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config form keyboard controls', () => {
    test('choice groups use radiogroup arrows and roving tabindex', async ({ page }) => {
        await openSection(page, 'appearance');
        const group = page.locator('.config-choices').filter({ has: page.locator('[data-appearance-theme]') }).first();
        await expect(group).toHaveAttribute('role', 'radiogroup');

        const light = group.locator('[data-appearance-theme="light"]');
        const dark = group.locator('[data-appearance-theme="dark"]');
        await light.focus();
        await page.keyboard.press('ArrowRight');
        await expect(dark).toHaveClass(/is-active/);
        await expect(dark).toHaveAttribute('tabindex', '0');
        await expect(light).toHaveAttribute('tabindex', '-1');
    });

    test('range sliders honour Home and End', async ({ page }) => {
        await openSection(page, 'appearance');
        const range = page.locator('[data-appearance-range="backgroundOpacity"]');
        await range.focus();
        await page.keyboard.press('End');
        await expect(range).toHaveValue('1');
        await page.keyboard.press('Home');
        await expect(range).toHaveValue('0.65');
    });

    test('bracket sub-tab shortcuts are ignored while a choice is focused', async ({ page }) => {
        await openSection(page, 'appearance');
        const light = page.locator('[data-appearance-theme="light"]').first();
        await light.focus();
        await page.keyboard.press(']');
        await expect(page.locator('[data-appearance-tab="custom-themes"][aria-selected="true"]')).toHaveCount(0);
    });

    test('stats period choices respond to arrow keys', async ({ page }) => {
        await openSection(page, 'stats');
        await page.locator('[data-stats-tab="activity"]').click();
        const group = page.locator('.config-choices').filter({ has: page.locator('[data-stats-range]') }).first();
        const first = group.locator('[data-stats-range]').first();
        const second = group.locator('[data-stats-range]').nth(1);
        await first.focus();
        await page.keyboard.press('ArrowRight');
        await expect(second).toHaveClass(/is-active/);
    });
});
