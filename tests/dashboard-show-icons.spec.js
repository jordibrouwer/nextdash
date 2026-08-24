// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissWhatsNewIfPresent } = require('./e2e-helpers');

test.describe('dashboard bookmark favicons toggle (showIcons)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await markWhatsNewSeen(page);
    });

    test('toggling showIcons off hides favicon slots on dashboard', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-icon-slot, #dashboard-layout .bookmark-icon', {
            timeout: 15_000,
        });
        await dismissWhatsNewIfPresent(page);

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
