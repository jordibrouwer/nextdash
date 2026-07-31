// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openAppearance(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-appearance-select="randomThemeMode"]')).toBeVisible();
}

const shown = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const stored = (page) => page.evaluate(() => window.dashboardInstance.settings.theme);

async function restoreRandomThemeDefaults(page) {
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const settings = await res.json();
        settings.randomThemeMode = 'off';
        settings.randomThemeOnRefresh = false;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
    });
}

async function setRandomThemeMode(page, mode) {
    await page.selectOption('[data-appearance-select="randomThemeMode"]', mode);
    await page.waitForTimeout(300);
}

test.describe('Random theme modes', () => {
    test.afterEach(async ({ page }) => {
        await restoreRandomThemeDefaults(page);
    });

    test('mode select is visible in appearance', async ({ page }) => {
        await openAppearance(page);
        await expect(page.locator('[data-appearance-select="randomThemeMode"]')).toBeVisible();
    });

    test('refresh mode keeps stored theme after reload', async ({ page }) => {
        await openAppearance(page);
        const beforeStored = await stored(page);
        await setRandomThemeMode(page, 'refresh');
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        expect(await stored(page)).toBe(beforeStored);
        expect(await shown(page)).toBeTruthy();
    });

    test('view mode changes theme when switching views', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await fetch('/api/settings');
            if (!res.ok) return;
            const settings = await res.json();
            settings.randomThemeMode = 'view';
            settings.randomThemeOnRefresh = true;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
        });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        const homeTheme = await shown(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect.poll(shown.bind(null, page)).not.toBe(homeTheme);
    });

    test('turning off restores stored theme', async ({ page }) => {
        await openAppearance(page);
        await setRandomThemeMode(page, 'view');
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await setRandomThemeMode(page, 'off');
        const resolved = await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            return window.ThemeLoader.resolveDisplayTheme(s.theme, s.autoDarkMode === true);
        });
        await expect.poll(shown.bind(null, page)).toBe(resolved);
    });

    test('with auto dark mode only matching variants are shown', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await fetch('/api/settings');
            if (!res.ok) return;
            const settings = await res.json();
            settings.randomThemeMode = 'refresh';
            settings.randomThemeOnRefresh = true;
            settings.autoDarkMode = true;
            settings.theme = 'moss-stone-dark';
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
        });

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });

        const theme = await shown(page);
        const isDarkVariant = theme === 'dark' || theme.endsWith('-dark');
        const isLightVariant = theme === 'light' || theme.endsWith('-light');
        expect(isDarkVariant || isLightVariant).toBe(true);

        const prefersDark = await page.evaluate(() =>
            window.matchMedia('(prefers-color-scheme: dark)').matches
        );
        if (prefersDark) {
            expect(isDarkVariant).toBe(true);
        } else {
            expect(isLightVariant).toBe(true);
        }
    });
});
