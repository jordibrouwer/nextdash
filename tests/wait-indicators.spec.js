// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Anything that makes the reader wait says so.
 *
 * A re-check from the Bookmarks panel used to mark a row in Health's own list,
 * which no longer exists, so nothing on screen moved while the site was asked.
 * And a dozen Data & backups actions -- clearing previews, restoring a backup,
 * downloading one -- ran with no sign of life. The progress overlay now shows
 * for any of them that takes longer than a moment, and the Bookmarks view
 * marks the row and panel it is working on.
 */

const overlay = (page) => page.locator('#nextdash-progress-overlay');

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.ProgressOverlay?.begin, null, { timeout: 10_000 });
}

test.describe('the progress overlay shows only for a noticeable wait', () => {
    test('a quick answer never shows it, a slow one does until it ends', async ({ page }) => {
        await loadDashboard(page);
        const quick = await page.evaluate(async () => {
            let seen = false;
            await window.ProgressOverlay.run('Quick', '', async () => {
                await new Promise((r) => setTimeout(r, 50));
                const el = document.getElementById('nextdash-progress-overlay');
                seen = Boolean(el && !el.hidden);
            });
            return seen;
        });
        expect(quick).toBe(false);

        await page.evaluate(() => {
            window.__end = window.ProgressOverlay.begin('Slow', 'status');
        });
        await expect(overlay(page)).toBeVisible();
        await expect(overlay(page)).toContainText('Slow');
        await page.evaluate(() => window.__end());
        await expect(overlay(page)).toBeHidden();
        // Ending twice is harmless.
        await page.evaluate(() => window.__end());
    });

    test('work that throws still takes the overlay down', async ({ page }) => {
        await loadDashboard(page);
        const threw = await page.evaluate(async () => {
            try {
                await window.ProgressOverlay.run('Failing', '', async () => {
                    await new Promise((r) => setTimeout(r, 500));
                    throw new Error('nope');
                });
                return false;
            } catch {
                return true;
            }
        });
        expect(threw).toBe(true);
        await expect(overlay(page)).toBeHidden();
    });
});

test.describe('Data & backups actions show that they are working', () => {
    test('clearing the link previews shows the overlay while the server works', async ({ page }) => {
        await loadDashboard(page);
        let release;
        const held = new Promise((r) => { release = r; });
        await page.route('**/api/previews/clear', async (route) => {
            await held;
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.evaluate(() => { void window.dashboardInstance.config.clearAllPreviews(); });
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect(overlay(page)).toBeVisible();
        await expect(overlay(page)).toContainText('Clearing link previews');
        release();
        await expect(overlay(page)).toBeHidden();
    });
});

test.describe('the Bookmarks view marks what it is checking', () => {
    test('a re-check from the panel marks the panel and the row until it answers', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, (issues) => issues, { view: 'library' });
        let release;
        const held = new Promise((r) => { release = r; });
        await page.route('**/api/ping**', async (route) => {
            await held;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'online', ms: 12 }) });
        });
        const name = bookmarks[1].name;
        const row = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first();
        await row.click();
        const panel = page.locator('#config-bm-panel');
        await expect(panel.locator('.config-bm-panel-title')).toHaveText(name);

        await panel.locator('.config-bm-panel-actions [data-bm-health-action="recheck"]').click();
        await expect(panel).toHaveClass(/is-health-busy/);
        await expect(panel).toHaveAttribute('aria-busy', 'true');
        await expect(row).toHaveClass(/is-health-busy/);

        release();
        await expect(page.locator('#config-bm-panel')).not.toHaveClass(/is-health-busy/);
        await expect(page.locator('#config-bm-list .config-bm-row.is-health-busy')).toHaveCount(0);
    });
});
