// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Appearance → Layout is ordered by how often a panel gets touched, and the
 * Launcher icon size sits with the preset it belongs to.
 *
 * It used to open on Layout version — a one-off beta switch — with Bookmarks
 * layout and Button bar below it, and the icon size stranded up in that same
 * version panel even though it only bites in the Launcher preset chosen two
 * controls further down. Bookmarks layout now leads and Layout version closes;
 * the icon size moved into Bookmarks layout as the last control above "Start
 * with categories collapsed". The button bar left for a tab of its own in
 * v1.3.0, so this tab is the grid and nothing else.
 */
async function openLayoutTab(page) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.locator('[data-appearance-tab="layout"]').click();
    await expect(page.locator('[data-behavior-field="launcherIconSize"]')).toBeVisible();
}

/** Visible panel headings, top to bottom. */
function panelTitles(page) {
    return page.locator('#config-section-panel .config-panel-title').allInnerTexts();
}

test.describe('appearance layout tab ordering', () => {
    test('Layout version closes the tab, and the button bar is not on it', async ({ page }) => {
        await openLayoutTab(page);

        const titles = (await panelTitles(page)).map((t) => t.trim());
        const bookmarks = titles.findIndex((t) => t.startsWith('Bookmarks layout'));
        const version = titles.findIndex((t) => t.startsWith('Layout version'));

        expect(bookmarks, 'Bookmarks layout panel missing').toBeGreaterThanOrEqual(0);
        expect(version, 'Layout version panel missing').toBeGreaterThanOrEqual(0);
        expect(bookmarks).toBeLessThan(version);

        // The bar and its buttons are one errand on one tab now.
        expect(titles.some((t) => t.startsWith('Button bar'))).toBe(false);
        await expect(page.locator('[data-appearance-barpos]')).toHaveCount(0);
    });

    test('Launcher icon size is the last control above "start collapsed"', async ({ page }) => {
        await openLayoutTab(page);

        // Both must live in the same panel — the point of the move.
        const sharePanel = await page.evaluate(() => {
            const icon = document.querySelector('[data-behavior-field="launcherIconSize"]');
            const collapse = document.querySelector('[data-behavior-field="alwaysCollapseCategories"]');
            if (!icon || !collapse) return null;
            return icon.closest('.config-panel') === collapse.closest('.config-panel');
        });
        expect(sharePanel, 'icon size and start-collapsed are not in one panel').toBe(true);

        // And in that order, with nothing bound to a field in between.
        const between = await page.evaluate(() => {
            const panel = document.querySelector('[data-behavior-field="launcherIconSize"]').closest('.config-panel');
            const fields = [...panel.querySelectorAll('[data-behavior-field]')]
                .map((el) => el.getAttribute('data-behavior-field'));
            const i = fields.indexOf('launcherIconSize');
            const j = fields.indexOf('alwaysCollapseCategories');
            return { i, j, fields };
        });
        expect(between.i).toBeGreaterThanOrEqual(0);
        expect(between.j).toBe(between.i + 1);
    });

    test('changing the icon size applies at once and saves', async ({ page }) => {
        await openLayoutTab(page);

        const select = page.locator('[data-behavior-field="launcherIconSize"]');
        await select.selectOption('large');

        // The size is a <body> attribute, so a re-render alone would not show
        // it — this is what the `visual` special exists for.
        await expect.poll(() => page.evaluate(() =>
            document.body.getAttribute('data-launcher-icon-size'))).toBe('large');

        await expect.poll(() => page.evaluate(async () => {
            const res = await fetch('/api/settings');
            return (await res.json()).launcherIconSize;
        })).toBe('large');

        // Put it back so the stored setting does not leak into other specs.
        await select.selectOption('normal');
        await expect.poll(() => page.evaluate(async () => {
            const res = await fetch('/api/settings');
            return (await res.json()).launcherIconSize;
        })).toBe('normal');
    });

    test('the settings search still points at the icon size control', async ({ page }) => {
        await openLayoutTab(page);

        const hit = await page.evaluate(() => window.dashboardInstance.config
            .filterSettingsJumpEntries('icon size')
            .find((e) => e.kind === 'field' && e.field === 'launcherIconSize'));
        expect(hit, 'launcherIconSize dropped out of the settings index').toBeTruthy();

        // The index has to resolve to something on screen; it used to name a
        // button group that no longer exists.
        const selector = await page.evaluate(() => window.dashboardInstance.config
            .settingsJumpControlSelector('launcherIconSize'));
        expect(selector).toBeTruthy();
        await expect(page.locator(selector)).toBeVisible();
    });
});
