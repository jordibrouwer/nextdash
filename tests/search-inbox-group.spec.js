// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A link waiting in the inbox is found by a name search, under its own header.
 */

const URL_TEXT = 'https://quokka-inbox.example/read';

async function bootstrap(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (url) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inboxEnabled: true }),
        });
        window.dashboardInstance.settings.inboxEnabled = true;
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        const items = Array.isArray(body) ? body : (body?.items || []);
        for (const it of items) {
            if (String(it.url).includes('quokka-inbox')) {
                await api(`/api/inbox?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' });
            }
        }
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title: 'Quokka field notes' }),
        });
        await window.dashboardInstance.inbox.load();
        await window.dashboardInstance.inbox.instance.loadItems();
    }, URL_TEXT);
}

test('a name search lists matching inbox links under In the inbox, with a badge', async ({ page }) => {
    await bootstrap(page);
    await page.keyboard.press('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.type('quokka', { delay: 10 });
    await page.keyboard.press('/');

    await expect(page.locator('.search-command-group-label', { hasText: 'In the inbox' })).toBeVisible({ timeout: 10_000 });
    const row = page.locator('.search-match').filter({ hasText: 'Quokka field notes' }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('.search-match-unsorted-badge')).toHaveText(/inbox/i);
});

test('a search nothing in the inbox matches has no inbox header', async ({ page }) => {
    await bootstrap(page);
    await page.keyboard.press('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.type('zzqxnomatch', { delay: 10 });
    await page.keyboard.press('/');
    await expect(page.locator('.search-command-group-label', { hasText: 'In the inbox' })).toHaveCount(0);
});

// A filtered search is about filed bookmarks: an inbox link has no category,
// page or status for the filter to read, so it stays out of the answer.
test('a filtered name search leaves the inbox group out', async ({ page }) => {
    await bootstrap(page);
    await page.keyboard.press('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    const labels = () => page.evaluate(() => (window.dashboardInstance.searchComponent.searchMatches || [])
        .filter((m) => m.type === 'command-group-header').map((m) => m.label));
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.currentQuery = '/quokka';
        s.updateSearch();
    });
    await expect.poll(labels).toContain('In the inbox');
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.currentQuery = '/category:development quokka';
        s.updateSearch();
    });
    await expect.poll(labels).not.toContain('In the inbox');
});
