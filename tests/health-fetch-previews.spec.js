// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Fetch previews, from the Bookmarks view's Collection menu: Health's sweep
 * over the whole collection, offered while something lacks a preview. The
 * availability check never asks a page for its title or image, so this is
 * the one action that can empty the missing-preview count.
 */

/** Two bookmarks without a preview; the rest fine. */
const twoWithoutPreview = (issues) => issues.map((issue, i) => (i < 2
    ? { ...issue, status: 'missing-preview', flags: ['missing-preview'], score: 95, reasons: [], reasonDetails: [] }
    : issue));

async function openSweep(page) {
    await openBookmarksWithHealth(page, twoWithoutPreview);
    await page.locator('.config-view--library [data-bm-header-more]').click();
    const item = page.locator('[data-bm-header-menu] [data-bm-header-action="fetch-previews"]');
    await expect(item).toBeVisible();
    await item.click();
}

test.describe('the fetch-previews sweep', () => {
    test('asks first, saying it is one request per bookmark over the whole collection', async ({ page }) => {
        let refreshCalls = 0;
        await page.route('**/api/previews/refresh**', (route) => {
            refreshCalls += 1;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await openSweep(page);
        const modal = page.locator('#app-modal.show');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/one request per bookmark/i);
        await expect(modal).toContainText(/whole collection/i);
        expect(refreshCalls).toBe(0);

        await modal.getByRole('button', { name: 'Fetch previews', exact: true }).click();
        await expect.poll(() => refreshCalls, { timeout: 10_000 }).toBe(1);
    });

    test('runs behind the counting progress overlay, and can be stopped', async ({ page }) => {
        let calls = 0;
        await page.route('**/api/previews/refresh**', async (route) => {
            calls += 1;
            const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
            // A collection big enough that the sweep is still running when the
            // assertions look at it.
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ total: 400, refreshed: 5, next: offset + 5, done: false }),
            });
        });
        await openSweep(page);
        await page.locator('#app-modal.show').getByRole('button', { name: 'Fetch previews', exact: true }).click();

        const overlay = page.locator('#nextdash-progress-overlay');
        await expect(overlay).toBeVisible();
        await expect(overlay.locator('[data-progress-status]')).toContainText(' of 400');
        await expect(overlay.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', /\d+/);

        const stop = overlay.locator('[data-progress-cancel]');
        await expect(stop).toBeVisible();
        await stop.click();
        await expect(overlay).toBeHidden({ timeout: 15_000 });
        // Stopped means stopped: no further round goes out.
        const seen = calls;
        await page.waitForTimeout(1000);
        expect(calls).toBe(seen);
    });

    /**
     * The endpoint is behind the sixty-a-minute limiter the preview and icon
     * fetches share. A refusal is not a failure: the server says how long to
     * wait.
     */
    test('waits a rate limit out instead of giving up', async ({ page }) => {
        let calls = 0;
        await page.route('**/api/previews/refresh**', async (route) => {
            calls += 1;
            if (calls === 1) {
                await route.fulfill({
                    status: 429,
                    headers: { 'Retry-After': '1' },
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'rate limited' }),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ total: 5, refreshed: 5, next: 5, done: true }),
            });
        });
        await openSweep(page);
        await page.locator('#app-modal.show').getByRole('button', { name: 'Fetch previews', exact: true }).click();
        await expect.poll(() => calls, { timeout: 20_000 }).toBe(2);
        await expect(page.locator('.app-notification')).toContainText(/previews fetched/i, { timeout: 20_000 });
    });
});
