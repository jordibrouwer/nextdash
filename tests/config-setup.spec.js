// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigReady(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.setupModule !== 'undefined');
    await page.waitForFunction(() => typeof window.configManager?.setupEventListeners === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => window.configManager.ui.switchToTab('general'));
}

test.describe('config setup (phase 5 wiring)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('config page loads with setup module wired', async ({ page }) => {
        await waitForConfigReady(page);
        const ready = await page.evaluate(() => (
            typeof window.configManager.setupDOM === 'function'
            && typeof window.configManager.updateHealthBadge === 'function'
            && document.body.hasAttribute('data-density-mode')
        ));
        expect(ready).toBe(true);
    });

    test('general panel expand state hook is registered', async ({ page }) => {
        await waitForConfigReady(page);
        const hasHook = await page.evaluate(() => (
            typeof window.configManager.refreshGeneralPanelExpandState === 'function'
        ));
        expect(hasHook).toBe(true);
    });

    test('bookmarks page selector change keeps config interactive', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('bookmarks'));
        await page.waitForSelector('[data-tab-content="bookmarks"].active', { timeout: 10_000 });

        const pageCount = await page.evaluate(() => window.configManager.getVisiblePages().length);
        if (pageCount < 2) {
            test.skip(true, 'Need at least two pages for selector test');
        }

        const switched = await page.evaluate(async () => {
            const cm = window.configManager;
            const pages = cm.getVisiblePages();
            const next = pages.find((p) => Number(p.id) !== Number(cm.currentPageId));
            if (!next) return false;
            const sel = document.getElementById('page-selector');
            if (!sel) return false;
            sel.value = String(next.id);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 300));
            return Number(cm.currentPageId) === Number(next.id);
        });
        expect(switched).toBe(true);
    });
});
