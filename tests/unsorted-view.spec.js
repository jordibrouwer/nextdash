// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

test('Unsorted view renders kept bookmarks in packed columns, chronologically', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // How the kept list is read is a setting now, so it outlives a test and
    // the next one would inherit a grouping it never chose.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        const s = window.dashboardInstance?.settings;
        if (s) { s.unsortedSort = 'added-desc'; s.unsortedGroup = 'none'; }
        const u = window.dashboardInstance?.unsorted;
        if (u) { u.sort = 'added-desc'; u.groupBy = 'none'; u.searchQuery = ''; u.brokenOnly = false; }
    });

    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Older', url: 'https://older-uv.example', category: '', createdAt: 1000 } }),
        });
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Newer', url: 'https://newer-uv.example', category: '', createdAt: 2000 } }),
        });
    });

    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');

    await expect(page.locator('.unsorted-view')).toBeVisible();
    // The rows arrive a moment after the view: read the text once they have.
    await expect(page.locator('.unsorted-view .bookmark-link', { hasText: 'Newer' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.unsorted-view .bookmark-link', { hasText: 'Older' })).toBeVisible({ timeout: 10_000 });
    const text = await page.locator('#dashboard-layout').innerText();
    expect(text.indexOf('Newer')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Newer')).toBeLessThan(text.indexOf('Older'));
});
