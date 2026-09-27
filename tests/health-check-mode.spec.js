// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Changing a bookmark's check mode from the Bookmarks view's side panel, which
 * writes through Health's own setCheckMode. The write is intercepted: the
 * endpoint's behaviour is covered by the Go tests.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
const checking = (page) => drawer(page).locator('[data-bm-pane="health"] [data-bm-acc="checking"]');

/** The first three bookmarks: monitored, periodic, not checked. */
const modes = (issues) => issues.map((issue, i) => ({
    ...issue,
    status: 'healthy', flags: ['healthy'], score: 100, reasons: [], reasonDetails: [],
    monitor: i === 0,
    checkStatus: i === 1,
}));

async function openChecking(page, bookmark) {
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmark.name }) }).first().click();
    await drawer(page).locator('[data-bm-tab-panel="health"]').click();
    const section = checking(page);
    if (await section.getAttribute('open') === null) await section.locator('summary').click();
    await expect(section.locator('[data-check-mode]')).toHaveCount(3);
    return section;
}

/** Capture check-mode writes without letting them touch the store. */
async function captureCheckMode(page, status = 200) {
    /** @type {any[]} */
    const calls = [];
    await page.route('**/api/health/check-mode', async (route) => {
        calls.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(status === 200 ? { mode: 'monitor' } : { error: 'stale' }),
        });
    });
    return calls;
}

test.describe('check mode from the side panel', () => {
    test('three named options, the current one checked', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, modes);
        const section = await openChecking(page, bookmarks[0]);
        await expect(section.locator('[data-check-mode="monitor"]')).toHaveAttribute('aria-checked', 'true');
        await expect(section.locator('[data-check-mode="off"]')).toHaveAttribute('aria-checked', 'false');
    });

    test('choosing a mode posts the row reference and its URL', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, modes);
        const calls = await captureCheckMode(page);
        const section = await openChecking(page, bookmarks[2]);
        await section.locator('[data-check-mode="monitor"]').click();

        await expect.poll(() => calls.length).toBe(1);
        // The URL rides along with the index so the server can reject a stale row.
        expect(calls[0]).toMatchObject({
            pageId: bookmarks[2].pageId,
            url: bookmarks[2].url,
            mode: 'monitor',
        });
        expect(Number.isInteger(calls[0].index)).toBe(true);
    });

    test('selecting the mode a row already has writes nothing', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, modes);
        const calls = await captureCheckMode(page);
        const section = await openChecking(page, bookmarks[0]);
        await section.locator('[data-check-mode="monitor"]').click();
        await page.waitForTimeout(400);
        expect(calls).toEqual([]);
    });

    test('a stale row is reported rather than silently retried', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, modes);
        const calls = await captureCheckMode(page, 409);
        const section = await openChecking(page, bookmarks[2]);
        await section.locator('[data-check-mode="monitor"]').click();
        await expect(page.locator('.app-notification')).toContainText(/refreshed/i, { timeout: 10_000 });
        expect(calls.length).toBe(1);
    });

    /**
     * CheckMode.intervalOf() reads a flat `monitorIntervalMinutes` field. The
     * report carries it directly, whether or not the bookmark has any samples
     * yet (monitorStats is absent until then): both shapes are covered.
     */
    test('the interval accent is correct with an established history', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, (issues) => modes(issues).map((issue, i) => (i === 0 ? {
            ...issue, monitorIntervalMinutes: 30,
            monitorStats: { intervalMinutes: 30, uptime24h: {}, uptime7d: {}, uptime30d: {}, totalChecks: 10 },
        } : issue)));
        const section = await openChecking(page, bookmarks[0]);
        await expect(section.locator('.health-check-interval-btn.is-active')).toHaveText('30m');
    });

    test('the interval accent is correct with no samples yet', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, (issues) => modes(issues).map((issue, i) => (i === 0
            ? { ...issue, monitorIntervalMinutes: 60 } : issue)));
        const section = await openChecking(page, bookmarks[0]);
        await expect(section.locator('.health-check-interval-btn.is-active')).toHaveText('1h');
    });
});
