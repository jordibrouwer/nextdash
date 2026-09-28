// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Any open modal holds the page still.
 *
 * Pages & categories on the Bookmarks view, the checking modal, the confirm
 * dialog and the progress overlay all built their own overlay and never took
 * the scroll lock, so the page behind them scrolled by its scrollbar. The
 * lock now follows whatever modal is open, without each one asking.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.ScrollLock, null, { timeout: 10_000 });
}

const locked = (page) => page.evaluate(() => document.body.style.overflow === 'hidden');

test.describe('an open modal locks the page', () => {
    test('Pages & categories locks while open and lets go on close', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.ensureBookmarkRenderers?.();
            await c.openStructureModal('pages');
        });
        await expect(page.locator('.config-structure-overlay')).toBeVisible();
        await expect.poll(() => locked(page)).toBe(true);

        await page.keyboard.press('Escape');
        await expect(page.locator('.config-structure-overlay')).toHaveCount(0);
        await expect.poll(() => locked(page)).toBe(false);
    });

    test('the progress overlay locks while it shows', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.ProgressOverlay.show('Working', 'status'));
        await expect.poll(() => locked(page)).toBe(true);
        await page.evaluate(() => window.ProgressOverlay.hide());
        await expect.poll(() => locked(page)).toBe(false);
    });

    test('a hidden modal host does not hold the lock', async ({ page }) => {
        await loadDashboard(page);
        // #app-modal stays in the DOM, visibility:hidden, between uses.
        await page.evaluate(() => {
            const el = document.createElement('div');
            el.id = 'probe-modal';
            el.setAttribute('aria-modal', 'true');
            el.style.cssText = 'position:fixed;inset:0;visibility:hidden';
            document.body.appendChild(el);
        });
        await page.waitForTimeout(100);
        expect(await locked(page)).toBe(false);
        await page.evaluate(() => { document.getElementById('probe-modal').style.visibility = 'visible'; });
        await expect.poll(() => locked(page)).toBe(true);
        await page.evaluate(() => document.getElementById('probe-modal').remove());
        await expect.poll(() => locked(page)).toBe(false);
    });

    test('a component lock and the modal lock release independently', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.__t = window.ScrollLock.acquire('probe-owner'); });
        await page.evaluate(() => window.ProgressOverlay.show('Working', 'status'));
        await page.evaluate(() => window.ProgressOverlay.hide());
        await page.waitForTimeout(150);
        // The component still holds its own lock.
        expect(await locked(page)).toBe(true);
        await page.evaluate(() => window.ScrollLock.release(window.__t));
        await expect.poll(() => locked(page)).toBe(false);
    });
});
