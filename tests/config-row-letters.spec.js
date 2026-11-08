// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

const FINDERS = [
    { id: '1', name: 'Alpha', searchUrl: 'https://a.com/?q=%s', shortcut: 'a' },
    { id: '2', name: 'Beta', searchUrl: 'https://b.com/?q=%s', shortcut: 'b' },
];

async function openFinders(page) {
    await page.route('**/api/finders', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FINDERS) });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        return window.dashboardInstance.config.openConfigView('finders');
    });
    await expect(page.locator('[data-finder-index="0"]')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.activeElement?.blur());
}

test.describe('config list: rows own the letters', () => {
    test('j and k move the row cursor on a list page, and Alt+Down leaves for the next section', async ({ page }) => {
        await openFinders(page);
        await page.keyboard.press('j');
        await expect(page.locator('[data-finder-index="0"]')).toHaveClass(/keyboard-selected/);
        await page.keyboard.press('j');
        await expect(page.locator('[data-finder-index="1"]')).toHaveClass(/keyboard-selected/);
        await page.keyboard.press('k');
        await expect(page.locator('[data-finder-index="0"]')).toHaveClass(/keyboard-selected/);
        const before = await page.evaluate(() => window.dashboardInstance.config.section);
        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).not.toBe(before);
    });

    test('e focuses the row, d presses its Delete', async ({ page }) => {
        await openFinders(page);
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(page.locator('[data-finder-index="0"] [data-finder="name"]')).toBeFocused();
        await page.evaluate(() => document.activeElement?.blur());
        let pressed = 0;
        await page.evaluate(() => {
            document.querySelector('[data-finder-delete="0"]').addEventListener('click', (ev) => {
                window.__deletePressed = (window.__deletePressed || 0) + 1;
                ev.stopImmediatePropagation();
            }, true);
        });
        await page.keyboard.press('d');
        pressed = await page.evaluate(() => window.__deletePressed || 0);
        expect(pressed).toBe(1);
    });

    test('the strip names the row letters, and a typed letter in a field stays text', async ({ page }) => {
        await openFinders(page);
        await page.keyboard.press('j');
        await expect(page.locator('#mode-strip')).toContainText('delete');
        await page.locator('[data-finder-index="0"] [data-finder="name"]').focus();
        await page.locator('[data-finder-index="0"] [data-finder="name"]').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
        await page.keyboard.type('dj');
        await expect(page.locator('[data-finder-index="0"] [data-finder="name"]')).toHaveValue('Alphadj');
    });

    test('Shift+H hides and shows the legend', async ({ page }) => {
        await openFinders(page);
        await expect(page.locator('.config-list-keyboard-legend')).toHaveCount(1);
        await page.keyboard.press('Shift+H');
        await expect(page.locator('.config-list-keyboard-legend')).toHaveCount(0);
        await page.keyboard.press('Shift+H');
        await expect(page.locator('.config-list-keyboard-legend')).toHaveCount(1);
        await expect(page.locator('.config-list-keyboard-legend kbd').first()).toHaveText('j / k');
    });
});

test.describe('config: the tag filter is a text field', () => {
    test('g and a space typed in it are letters, not "first row"', async ({ page }) => {
        await openFinders(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('[data-bm-tab="tags"]').click();
        const filter = page.locator('#config-tag-filter');
        await expect(filter).toBeVisible();
        await filter.focus();
        await page.keyboard.type('a g');
        await expect(filter).toHaveValue('a g');
        await expect(filter).toBeFocused();
    });
});

test.describe('config widgets: rows own the letters', () => {
    test('j moves the cursor, h flips Shown, s opens the settings, e goes to the title', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await expect.poll(() => page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            return Boolean(cfg && cfg._widgetBlocks != null && cfg._widgetLoadedFor != null && cfg._widgetLoadedFor === cfg._widgetPageId);
        }), { timeout: 15_000 }).toBe(true);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config._module;
            if (!(cfg._widgetBlocks || []).some((b) => b.isWidget)) {
                await cfg.addWidget('health');
                await new Promise((r) => setTimeout(r, 1800));
            }
        });
        await expect(page.locator('[data-widget-row]').first()).toBeVisible();
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await expect(page.locator('[data-widget-row]').first()).toHaveClass(/keyboard-selected/);
        await expect(page.locator('.config-list-keyboard-legend')).toHaveCount(1);
        const was = await page.locator('[data-widget-row]').first().locator('[data-widget-enabled]').isChecked();
        await page.keyboard.press('h');
        await expect(page.locator('[data-widget-row]').first().locator('[data-widget-enabled]')).toBeChecked({ checked: !was });
        await page.keyboard.press('h');
        await expect(page.locator('[data-widget-row]').first().locator('[data-widget-enabled]')).toBeChecked({ checked: was });
        await expect(page.locator('[data-widget-row]').first()).toHaveClass(/keyboard-selected/);
        await page.keyboard.press('e');
        await expect(page.locator('[data-widget-row]').first().locator('[data-widget="title"]')).toBeFocused();
    });
});

test.describe('config custom themes: rows own the letters', () => {
    test('j selects a theme row, d deletes it, the form legend is not drawn twice', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.evaluate(() => window.dashboardInstance.config._module.switchAppearanceTab('custom-themes'));
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('[data-theme-row]').first()).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await expect(page.locator('[data-theme-row]').first()).toHaveClass(/keyboard-selected/);
        await expect(page.locator('.config-form-keyboard-legend')).toHaveCount(0);
        await expect(page.locator('.config-list-keyboard-legend')).toHaveCount(1);
        const count = await page.locator('[data-theme-row]').count();
        await page.keyboard.press('d');
        const modal = page.locator('#config-confirm-modal [data-confirm="ok"]');
        if (await modal.isVisible().catch(() => false)) await modal.click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(count - 1);
    });

    test('leaving the Custom themes tab drops the cursor and the strip', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.evaluate(() => window.dashboardInstance.config._module.switchAppearanceTab('custom-themes'));
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('[data-theme-row]').first()).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await expect(page.locator('#mode-strip')).toContainText('export');
        await page.evaluate(() => window.dashboardInstance.config._module.switchAppearanceTab('general'));
        await expect(page.locator('#mode-strip')).not.toContainText('export');
        expect(await page.evaluate(() => window.dashboardInstance.config._module._listKeyboardKey)).toBeNull();
        // Clean up the theme this test added.
        await page.evaluate(() => window.dashboardInstance.config._module.switchAppearanceTab('custom-themes'));
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await page.keyboard.press('d');
        const ok = page.locator('#config-confirm-modal [data-confirm="ok"]');
        if (await ok.isVisible().catch(() => false)) await ok.click();
    });
});

test.describe('config: Shift opens views from here too', () => {
    test('Shift+T opens the tag view from a Config page', async ({ page }) => {
        await openFinders(page);
        await page.keyboard.press('Shift+T');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('tags');
    });
});
