// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    WRITE_TOKEN,
} = require('./e2e-helpers');

const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * The trash tab under Config → Data & backups.
 *
 * A deleted bookmark is recoverable for 30 days, which is the case toast-undo
 * cannot serve: the undo lives as long as the toast, and the mistake is often
 * noticed much later.
 */
async function openTrashTab(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="trash"]').click();
}

test.describe('config trash', () => {
    test('an empty trash says so', async ({ page }) => {
        await openTrashTab(page);
        const cleared = await page.request.delete('/api/trash', {
            data: { all: true },
            headers: writeHeaders,
        });
        expect(cleared.ok()).toBe(true);

        await page.evaluate(() => window.dashboardInstance.config.loadTrash());
        await expect(page.locator('.config-panel-empty')).toBeVisible();
    });

    test('a deleted bookmark is listed and restores from the tab', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });

        await page.request.delete('/api/trash', { data: { all: true }, headers: writeHeaders });

        // Seed a bookmark this test owns, then delete it the way the dashboard
        // does — through the row's own delete path, not by calling the API.
        const marker = `cfg-trash-${Date.now()}`;
        await page.evaluate(async (name) => {
            const d = window.dashboardInstance;
            d.bookmarks.push({ name, url: `https://${name}.example`, category: '', shortcut: '' });
            await d.saveBookmarkOrder();
            d.renderDashboard();
        }, marker);

        await page.evaluate(async (name) => {
            const d = window.dashboardInstance;
            const index = d.bookmarks.findIndex((b) => b.name === name);
            await d.deleteBookmarkAtIndexInline(
                { bookmark: d.bookmarks[index], index, scope: 'current', pageId: d.currentPageId, original: { ...d.bookmarks[index] } },
                { skipConfirm: true }
            );
        }, marker);

        await expect
            .poll(async () => (await (await page.request.get('/api/trash')).json()).count, { timeout: 10_000 })
            .toBe(1);

        // It shows up on the tab...
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.locator('[data-db-tab="trash"]').click();
        await expect(page.locator('.config-backup-name', { hasText: marker })).toBeVisible();

        // ...and Restore puts it back on the page.
        await page.locator('[data-trash-action="restore"]').first().click();

        await expect
            .poll(async () => {
                const list = await (await page.request.get('/api/bookmarks?page=1')).json();
                return list.some((b) => b.name === marker);
            }, { timeout: 10_000 })
            .toBe(true);

        await expect
            .poll(async () => (await (await page.request.get('/api/trash')).json()).count)
            .toBe(0);
    });

    test('the tab is reachable by deep link', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/#config/data-backups/trash');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);

        // The panel must resolve past its loading state on a cold open.
        await expect(page.locator('[data-db-tab="trash"]')).toHaveAttribute('aria-selected', 'true');
        await expect
            .poll(() => page.locator('.config-view-loading').count(), { timeout: 10_000 })
            .toBe(0);
    });
});
