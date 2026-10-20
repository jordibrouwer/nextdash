// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, openConfigPanel } = require('./e2e-helpers');

/**
 * Appearance's tab strip reads in three labelled groups, and a few settings
 * moved to the tab that is about them: link preview cards have a tab of their
 * own, Clock & weather leads Date & weather, bookmark favicons are one panel
 * on Rows, and the browser tab's title and icon are one panel on Header.
 */

async function open(page, hash) {
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
}

const tab = (page, id) => page.locator(`[data-appearance-tab="${id}"]`);

test.describe('the grouped strip', () => {
    test('three group labels, in order, over one tablist', async ({ page }) => {
        await open(page, '#config/appearance');
        await expect(page.locator('.config-subtabs--grouped > .config-subtab-group .config-subtab-group-label'))
            .toHaveText(['Look', 'Bookmarks', 'Header & bars']);
        await expect(page.locator('.config-subtabs--grouped')).toHaveAttribute('role', 'tablist');
        await expect(page.locator('.config-subtab-group').first()).toHaveAttribute('role', 'presentation');
        // The labels are decoration: the tab names carry the meaning.
        await expect(page.locator('.config-subtab-group-label').first()).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('[data-appearance-group="bookmarks"] [data-appearance-tab]'))
            .toHaveText(['Layout', 'Rows', 'Previews']);
    });

    test('arrow keys walk across the group boundary', async ({ page }) => {
        await open(page, '#config/appearance/surface');
        await tab(page, 'surface').focus();
        await page.keyboard.press('ArrowRight');
        await expect(tab(page, 'layout')).toHaveAttribute('aria-selected', 'true');
    });

    test('the old words still open the tabs', async ({ page }) => {
        await open(page, '#config/appearance/link-previews');
        await expect(tab(page, 'previews')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-behavior-field="linkPreviewMode"]').first()).toBeVisible();
        for (const [alias, id] of [['theme-type', 'general'], ['surfaces', 'surface'], ['bookmarks-layout', 'layout'], ['link-preview', 'previews']]) {
            await page.goto(`/#config/appearance/${alias}`);
            await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
        }
    });

    test('every tab is on screen: the groups wrap rather than scroll', async ({ page }) => {
        for (const width of [800, 375]) {
            await page.setViewportSize({ width, height: 900 });
            await open(page, '#config/appearance/display');
            const strip = await page.evaluate(() => {
                const el = document.querySelector('.config-subtabs--grouped');
                const box = el.getBoundingClientRect();
                const tabs = [...el.querySelectorAll('[data-appearance-tab]')];
                return {
                    scrolls: el.scrollWidth > el.clientWidth + 1,
                    outside: tabs.filter((t) => {
                        const r = t.getBoundingClientRect();
                        return r.left < box.left - 1 || r.right > box.right + 1;
                    }).length,
                    // Each group has its label in front of its first tab.
                    labels: [...el.querySelectorAll('.config-subtab-group')].map((g) => {
                        const label = g.querySelector('.config-subtab-group-label').getBoundingClientRect();
                        const first = g.querySelector('[data-appearance-tab]').getBoundingClientRect();
                        return label.right <= first.left + 1 && label.bottom > first.top && label.top < first.bottom;
                    }),
                };
            });
            expect(strip.scrolls, `at ${width}px`).toBe(false);
            expect(strip.outside, `at ${width}px`).toBe(0);
            expect(strip.labels).toEqual([true, true, true]);
        }
    });

    test('on a wide window the strip is one line', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await open(page, '#config/appearance');
        const rows = await page.evaluate(() => new Set([...document.querySelectorAll(
            '.config-subtabs--grouped [data-appearance-tab], .config-subtabs--grouped .config-subtab-group-label')]
            .map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2))).size);
        expect(rows).toBe(1);
    });

    test('Rows no longer holds the link preview panel', async ({ page }) => {
        await open(page, '#config/appearance/display');
        await expect(page.locator('[data-behavior-field="showStatus"]')).toHaveCount(1);
        await expect(page.locator('[data-behavior-field="linkPreviewMode"]')).toHaveCount(0);
    });
});

test.describe('settings that moved home', () => {
    test('Clock & weather leads Date & weather and is gone from Header', async ({ page }) => {
        await open(page, '#config/appearance/datetime');
        await expect(page.locator('[data-behavior-field="headerClockPlacement"]')).toBeVisible();
        const first = await page.locator('#config-appearance-body .config-panel-title').first().textContent();
        expect(first).toBe('Clock & weather');
        await tab(page, 'header').click();
        await expect(tab(page, 'header')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-behavior-field="headerClockPlacement"]')).toHaveCount(0);
    });

    test('Favicons is one panel on Rows and gone from Theme & type', async ({ page }) => {
        await open(page, '#config/appearance/display');
        const panel = page.locator('#config-appearance-body .config-panel', { has: page.locator('[data-appearance-toggle="showIcons"]') });
        await expect(panel.locator('.config-panel-title')).toHaveText('Favicons');
        await expect(panel.locator('[data-appearance-toggle-icons]').first()).toBeVisible();
        await expect(panel.locator('[data-appearance-toggle="colorizeStatus"]')).toBeVisible();
        await tab(page, 'general').click();
        await expect(page.locator('[data-appearance-select="fontPreset"]')).toHaveCount(1);
        await expect(page.locator('[data-appearance-toggle-icons]')).toHaveCount(0);
        await expect(page.locator('[data-appearance-toggle="showIcons"]')).toHaveCount(0);
    });

    test('Browser tab & branding is one panel on Header', async ({ page }) => {
        await open(page, '#config/appearance/header');
        await openConfigPanel(page, 'Browser tab & branding');
        const panel = page.locator('#config-appearance-body .config-panel', { has: page.locator('[data-appearance-text="customTitle"]') });
        await expect(panel.locator('.config-panel-title')).toHaveText('Browser tab & branding');
        await expect(panel.locator('[data-appearance-toggle="showPageInTitle"]')).toBeVisible();
        await expect(panel.locator('[data-appearance-toggle="enableCustomTitle"]')).toBeVisible();
        await expect(panel.locator('[data-appearance-action="upload-favicon"]')).toBeVisible();
        // Both page-title settings in one place, none left behind.
        await expect(page.locator('#config-appearance-body [data-appearance-toggle="showPageInTitle"]')).toHaveCount(1);
    });

    test('Find settings jumps to a moved setting on its new tab', async ({ page }) => {
        await open(page, '#config/appearance/general');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('Show the page name in the browser title');
        const hit = page.locator('.config-settings-jump-result', { hasText: 'Show the page name in the browser title' }).first();
        await expect(hit).toContainText('Header');
        await hit.click();
        await expect(tab(page, 'header')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-appearance-toggle="showPageInTitle"]')).toBeVisible();
    });

    test('the page-title switch writes its setting', async ({ page }) => {
        await open(page, '#config/appearance/header');
        await openConfigPanel(page, 'Browser tab & branding');
        const box = page.locator('[data-appearance-toggle="showPageInTitle"]');
        const saved = () => page.evaluate(async () => (await (await fetch('/api/settings')).json()).showPageInTitle === true);
        const before = await box.isChecked();
        await box.setChecked(!before);
        await expect.poll(saved).toBe(!before);
        await box.setChecked(before);
        await expect.poll(saved).toBe(before);
    });
});
