// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Kept links that are already filed somewhere else.
 *
 * The row said so ("already on …") and left it there: the second copy could
 * only be cleared by ticking it and deleting, one at a time or by hunting for
 * them. The hint is now the way out, and the list can be narrowed to them.
 */

async function bootstrap(page, slug) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (s) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        const settings = window.dashboardInstance?.settings;
        if (settings) { settings.unsortedSort = 'added-desc'; settings.unsortedGroup = 'none'; }
        const add = (pageId, bookmark) => api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: pageId, bookmark: { category: '', ...bookmark }, allowDuplicate: true }),
        });
        for (const n of ['one', 'two']) {
            await add(1, { name: `Filed ${s} ${n}`, url: `https://${s}-${n}-ud.example/` });
            await add(999999, { name: `Kept ${s} ${n}`, url: `https://${s}-${n}-ud.example/`, createdAt: 5000 });
        }
        await add(999999, { name: `Only ${s}`, url: `https://${s}-only-ud.example/`, createdAt: 4000 });
    }, slug);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');
    await expect(page.locator('.unsorted-view-search-input')).toBeVisible();
    await page.locator('.unsorted-view-search-input').fill(`${slug}-`);
    await expect(page.locator('.bookmark-link[data-unsorted-key]')).toHaveCount(3);
}

async function keptUrls(page) {
    return page.evaluate(async () => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).map((b) => b.url);
    });
}

async function filedUrls(page) {
    return page.evaluate(async () => {
        const rows = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return rows.map((b) => b.url);
    });
}

test('the already-filed hint removes the kept copy, and the toast puts it back', async ({ page }) => {
    await bootstrap(page, 'hint');
    const url = 'https://hint-one-ud.example/';
    const hint = page.locator('.unsorted-row-filed', { hasText: 'already on' }).first();
    await expect(hint).toBeVisible();
    await expect(hint).toHaveJSProperty('tagName', 'BUTTON');
    const row = page.locator('.bookmark-link[data-unsorted-key]', { hasText: 'Kept hint one' });
    await row.locator('xpath=following-sibling::*[contains(@class,"unsorted-row-hints")][1]')
        .locator('.unsorted-row-filed').click();

    await expect.poll(() => keptUrls(page)).not.toContain(url);
    expect(await filedUrls(page)).toContain(url);

    await page.locator('.app-notification', { hasText: 'Deleted' }).locator('.app-notification-action').click();
    await expect.poll(() => keptUrls(page)).toContain(url);
});

test('the list narrows to the second copies, and clears them in one go', async ({ page }) => {
    await bootstrap(page, 'many');
    const note = page.locator('.unsorted-dupes-note');
    await expect(note).toContainText('already filed');
    await note.locator('.unsorted-dupes-btn').click();
    await expect(page.locator('.bookmark-link[data-unsorted-key]')).toHaveCount(2);

    await note.locator('.unsorted-dupes-clear').click();
    await page.locator('.modal-button.danger').click();

    await expect.poll(async () => (await keptUrls(page)).filter((u) => u.includes('many-'))).toEqual(
        ['https://many-only-ud.example/']);
    const filed = await filedUrls(page);
    expect(filed).toEqual(expect.arrayContaining(['https://many-one-ud.example/', 'https://many-two-ud.example/']));
});
