// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openAppearance(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-appearance-randommode="off"]')).toBeVisible();
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
    await page.locator(`[data-appearance-randommode="${mode}"]`).click();
    // The panel repaints after the settings POST, so wait for the button that
    // comes back marked active rather than a fixed delay.
    await expect(page.locator(`[data-appearance-randommode="${mode}"]`))
        .toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
}

test.describe('Random theme modes', () => {
    test.afterEach(async ({ page }) => {
        await restoreRandomThemeDefaults(page);
    });

    test('mode buttons are visible in appearance', async ({ page }) => {
        await openAppearance(page);
        await expect(page.locator('[data-appearance-randommode="off"]')).toBeVisible();
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

    test('view mode does not reload theme.css on view switch', async ({ page }) => {
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
        await page.evaluate(() => {
            window.__themeCssReloadCount = 0;
            const orig = window.VisualSettings.reloadThemeCSS;
            window.VisualSettings.reloadThemeCSS = function patchedReloadThemeCSS() {
                window.__themeCssReloadCount += 1;
                return orig.apply(this, arguments);
            };
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        expect(await page.evaluate(() => window.__themeCssReloadCount)).toBe(0);
    });

    test('view mode changes theme when switching dashboard pages', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        const pageCount = await page.evaluate(() => window.dashboardInstance.pages.length);
        test.skip(pageCount < 2, 'needs at least two pages');
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
        const firstPageTheme = await shown(page);
        const targetPageId = await page.evaluate(() => Number(window.dashboardInstance.pages[1].id));
        await page.evaluate(async (pageId) => {
            await window.dashboardInstance.requestPageNavigation(pageId);
        }, targetPageId);
        await expect.poll(shown.bind(null, page)).not.toBe(firstPageTheme);
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

    test('changing theme while random is on shows a toast', async ({ page }) => {
        await openAppearance(page);
        await setRandomThemeMode(page, 'view');
        const current = await stored(page);
        const pick = current === 'light' ? 'dark' : 'light';
        await page.locator(`[data-appearance-theme="${pick}"]`).click();
        await expect(page.locator('.app-notification')).toContainText(
            /random theme|willekeurig|zufällig|aléatoire/i,
            { timeout: 5000 }
        );
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
