// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * "Follow system dark mode" pairs the stored theme with the OS preference:
 * moss-stone-dark displays as moss-stone-light while the OS is light. The
 * config view applied the stored theme directly and reduced it to bare
 * light/dark, so the toggle appeared to do nothing and the chosen theme was
 * thrown away with it.
 */
async function openAppearance(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-appearance-toggle="autoDarkMode"]')).toBeVisible();
}

const shown = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const stored = (page) => page.evaluate(() => window.dashboardInstance.settings.theme);

test.describe('follow system dark mode — light OS', () => {
    test.use({ colorScheme: 'light' });

    test('turning it on switches a dark theme to its light variant', async ({ page }) => {
        await openAppearance(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.autoDarkMode = false;
            window.dashboardInstance.config.setTheme('moss-stone-dark');
        });
        await expect.poll(() => shown(page)).toBe('moss-stone-dark');

        await page.locator('[data-appearance-toggle="autoDarkMode"]').check();
        await expect.poll(() => shown(page)).toBe('moss-stone-light');
        // The choice itself is kept: only the displayed variant follows the OS.
        expect(await stored(page)).toBe('moss-stone-dark');
    });

    test('turning it off returns to the stored theme', async ({ page }) => {
        await openAppearance(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.autoDarkMode = true;
            window.dashboardInstance.config.setTheme('moss-stone-dark');
        });
        await expect.poll(() => shown(page)).toBe('moss-stone-light');

        await page.locator('[data-appearance-toggle="autoDarkMode"]').uncheck();
        await expect.poll(() => shown(page)).toBe('moss-stone-dark');
    });
});

test.describe('follow system dark mode — dark OS', () => {
    test.use({ colorScheme: 'dark' });

    test('turning it on switches a light theme to its dark variant', async ({ page }) => {
        await openAppearance(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.autoDarkMode = false;
            window.dashboardInstance.config.setTheme('moss-stone-light');
        });
        await expect.poll(() => shown(page)).toBe('moss-stone-light');

        await page.locator('[data-appearance-toggle="autoDarkMode"]').check();
        await expect.poll(() => shown(page)).toBe('moss-stone-dark');
        expect(await stored(page)).toBe('moss-stone-light');
    });

    test('picking another theme keeps following the system', async ({ page }) => {
        await openAppearance(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.autoDarkMode = true;
            // A light variant chosen while the OS is dark must still show dark.
            window.dashboardInstance.config.setTheme('midnight-ink-light');
        });
        await expect.poll(() => shown(page)).toBe('midnight-ink-dark');
    });

    test('the attribute ThemeLoader reads on the next load is kept in sync', async ({ page }) => {
        await openAppearance(page);
        await page.locator('[data-appearance-toggle="autoDarkMode"]').check();
        await expect.poll(() => page.evaluate(() =>
            document.documentElement.getAttribute('data-auto-dark-mode'))).toBe('true');
        await page.locator('[data-appearance-toggle="autoDarkMode"]').uncheck();
        await expect.poll(() => page.evaluate(() =>
            document.documentElement.getAttribute('data-auto-dark-mode'))).toBe('false');
    });
});
