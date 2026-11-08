const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/*
 * The corner cards can be asked for again.
 *
 * A card you waved away had no road back. Config → Behavior → Privacy lists them
 * with what became of each, and Show again puts back the ones that were answered.
 */

let stateBefore = null;

async function openPanel(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    stateBefore = await page.evaluate(() => window.DiscoverabilityState.exportState());
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.waitForSelector('[data-behavior-tab="privacy"]', { timeout: 15_000 });
    await page.locator('[data-behavior-tab="privacy"]').click();
}

test.describe('notice cards on the config panel', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(async (previous) => {
            const d = window.dashboardInstance;
            if (!d?.settings) return;
            window.DiscoverabilityState?.init?.(previous || {});
            await d.saveSettings?.();
            localStorage.removeItem('nextdashHealthReviewDoneOn');
        }, stateBefore).catch(() => { /* the page may already be closed */ });
        stateBefore = null;
    });

    test('the cards that moved to the bell are no longer listed', async ({ page }) => {
        await openPanel(page);
        await expect(page.locator('[data-notice-cards]')).toBeVisible();
        for (const id of ['kept-pile', 'theme-studio', 'tag-suggestions', 'analytics',
            'health-review', 'health-recheck-offer', 'docker-update', 'inbox-extension']) {
            await expect(page.locator(`[data-notice-card="${id}"]`)).toHaveCount(0);
        }
        await expect(page.locator('[data-notice-card="digest"]')).toHaveCount(1);
    });

    test('the digest card is listed and put back', async ({ page }) => {
        await openPanel(page);
        await page.evaluate(() => {
            localStorage.setItem('nextdashDigestSeenAt', '1760000000000');
            localStorage.setItem('nextdashDigestCard', JSON.stringify({ generatedAt: 1760000000000, seenAt: 1760000000000 }));
            window.dashboardInstance.config.render();
        });
        const digest = page.locator('[data-notice-card="digest"]');
        await expect(digest).toBeEnabled({ timeout: 10_000 });
        await digest.click();
        await expect.poll(() => page.evaluate(
            () => [localStorage.getItem('nextdashDigestSeenAt'), localStorage.getItem('nextdashDigestCard')]),
        { timeout: 10_000 }).toEqual([null, null]);
    });

    test('Bring back dismissed notifications puts a bell "No" back in the bell', async ({ page }) => {
        const ROW = '.notification-bell-row[data-bell-id="probe-forever"]';
        await openPanel(page);
        // A quiet row whose "No" is for good, standing in for the real ones.
        await page.evaluate(() => {
            window.NotificationBell.register({
                id: 'probe-forever', group: 'privacy', kind: 'quiet', no: 'forever',
                state: async () => ({ count: 1, text: 'Probe row' }),
            });
        });
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await page.evaluate(() => window.NotificationBell.open());
        await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
        await expect(page.locator(ROW)).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(page.locator(ROW)).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.close());

        await page.getByRole('button', { name: 'Bring back dismissed notifications' }).click();
        await expect(page.locator('.toast, [role="status"]').filter({ hasText: 'back in the bell' }).first()).toBeVisible({ timeout: 10_000 });

        await page.evaluate(() => window.NotificationBell.open());
        await expect(page.locator(ROW)).toBeVisible({ timeout: 10_000 });
    });
});
