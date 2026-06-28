// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
}

test.describe('dashboard bookmark favicons toggle (showIcons)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.addInitScript(() => {
            try {
                localStorage.setItem('nextdash:last-whats-new-dashboard-release', '2026.06-dashboard-release-v72');
            } catch {
                // ignore
            }
        });
    });

    test('config general essentials exposes show-icons checkbox', async ({ page }) => {
        await page.goto('/config#general');
        await page.waitForSelector('.general-layout', { timeout: 15_000 });
        await page.evaluate(() => window.configManager?.ui?.switchToTab?.('general'));

        const essentials = page.locator('[data-general-panel="bookmarks-essentials"]');
        await expect(essentials).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => {
            const card = document.querySelector('[data-general-panel="bookmarks-essentials"]');
            card?.classList.remove('is-collapsed');
            const title = card?.querySelector('.section-title');
            title?.setAttribute('aria-expanded', 'true');
        });

        const inEssentials = await page.evaluate(() => {
            const essentialsPanel = document.querySelector('[data-general-panel="bookmarks-essentials"]');
            const checkbox = document.getElementById('show-icons-checkbox');
            return Boolean(essentialsPanel && checkbox && essentialsPanel.contains(checkbox));
        });
        expect(inEssentials).toBe(true);

        const checkbox = essentials.locator('#show-icons-checkbox');
        await expect(checkbox).toBeChecked();
    });

    test('toggling showIcons off hides favicon slots on dashboard', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-icon-slot, #dashboard-layout .bookmark-icon', {
            timeout: 15_000,
        });
        await dismissOverlays(page);

        const iconsBefore = await page.locator('#dashboard-layout .bookmark-icon-slot').count();
        expect(iconsBefore).toBeGreaterThan(0);

        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await fetch('/api/settings');
            const settings = await res.json();
            settings.showIcons = false;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const d = window.dashboardInstance;
            if (d) {
                d.settings.showIcons = false;
                d.renderDashboard({ animate: false, incremental: 'settings' });
            }
        });

        await expect(page.locator('#dashboard-layout .bookmark-icon-slot')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();

        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await fetch('/api/settings');
            const settings = await res.json();
            settings.showIcons = true;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const d = window.dashboardInstance;
            if (d) {
                d.settings.showIcons = true;
                d.renderDashboard({ animate: false, incremental: 'settings' });
            }
        });

        await expect(page.locator('#dashboard-layout .bookmark-icon-slot').first()).toBeVisible({
            timeout: 10_000,
        });
    });
});
