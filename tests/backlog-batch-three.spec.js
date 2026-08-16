// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The third batch: two settings that could only be changed one at a time, one
 * change that never reached the device next to you, and a category you could
 * only reorder with the mouse.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

test.describe('a config change reaches the other device', () => {
    test('the poll applies settings, not only bookmarks', async ({ page }) => {
        await dashboard(page);

        const applied = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            // Pretend this device already polled once, so the next poll has a
            // previous settings revision to compare against.
            await d.data.fetchAndStoreDataRevision();
            d._serverSettingsRevision = d.data._lastSettingsRevision;

            const before = d.settings.showBackgroundDots;
            const stored = await (await api('/api/settings')).json();
            stored.showBackgroundDots = !before;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(stored),
            });

            // The poll used to reload bookmarks, inbox and health and never
            // settings, so the chrome stayed as it was until a manual reload.
            await d.data.refreshIfDataRevisionChanged();
            return { before, after: d.settings.showBackgroundDots };
        });
        expect(applied.after).toBe(!applied.before);
    });

    test('the endpoint reports a settings fingerprint of its own', async ({ page }) => {
        await dashboard(page);
        const body = await page.evaluate(async () =>
            (await (await fetch('/api/data-revision', { cache: 'no-store' })).json()));
        expect(typeof body.revision).toBe('string');
        expect(typeof body.settingsRevision).toBe('string');
        expect(body.settingsRevision).not.toBe('');
        expect(body.settingsRevision).not.toBe(body.revision);
    });
});

test.describe('a category can be moved from the keyboard', () => {
    test('Alt+arrow on a header reorders, and focus follows the category', async ({ page }) => {
        await dashboard(page);
        const order = () => page.evaluate(() =>
            (window.dashboardInstance.categories || []).map((c) => String(c.id)));

        const before = await order();
        test.skip(before.length < 2, 'needs two categories');

        // Through the header, which is where F2, Delete and Shift+W already act
        // and where there was no key to move the category itself.
        await page.evaluate(() => {
            const el = document.querySelector('.category:not([data-smart-collection="true"]) .category-title');
            el?.focus();
        });
        const focusedId = await page.evaluate(() =>
            document.activeElement?.closest('.category')?.getAttribute('data-category-id'));
        test.skip(!focusedId, 'no focusable category header');

        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(order, { timeout: 5_000 }).not.toEqual(before);

        // The header is rebuilt by the render, so focus follows the category
        // rather than the node that used to hold it.
        await expect.poll(() => page.evaluate(() =>
            document.activeElement?.closest('.category')?.getAttribute('data-category-id')),
        { timeout: 5_000 }).toBe(focusedId);
    });
});

test.describe('alert muting can be set on a group', () => {
    test('the health bulk bar offers mute and unmute', async ({ page }) => {
        await dashboard(page);
        // The health module is loaded on demand.
        await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
        await page.waitForTimeout(1500);
        const html = await page.evaluate(() => {
            const health = window.dashboardInstance.health?._module || window.dashboardInstance.health;
            const multi = health?.multiSelect || health?.multi;
            if (!multi?.renderToolbar) return null;
            multi.selected = new Set(['x']);
            return multi.renderToolbar();
        });
        test.skip(!html, 'health module has no multi-select here');
        // Check mode was the only per-bookmark health setting a selection could
        // change; muting is the one people most want on a group.
        expect(html).toContain('data-bulk="mute"');
        expect(html).toContain('data-bulk="unmute"');
    });
});
