// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');
const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Config → Structure → Pages works from the page list the tab loaded.
 *
 * A page made on another device since was not in it: Add page and Duplicate
 * handed out that page's id again, and a duplicate with its bookmarks wrote
 * them over that page's -- gone, and not in the trash. And every save sent
 * the whole stale list, so a rename made on the other device was put back by
 * the next reorder here.
 */

async function pagesTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.ptTab = 'pages';
        return c.openConfigView('structure');
    });
    await expect(page.locator('[data-page-duplicate]').first()).toBeVisible({ timeout: 10_000 });
}

/*
 * What another device does: talk to the server from outside this tab, so
 * nothing in the tab hears of it.
 */
async function pagesElsewhere(page) {
    return (await page.request.get('/api/pages')).json();
}

async function savePagesElsewhere(page, pages) {
    const res = await page.request.post('/api/pages', { data: pages, headers: writeHeaders });
    expect(res.ok()).toBe(true);
}

async function addPageElsewhere(page, name, url) {
    const pages = await pagesElsewhere(page);
    const id = pages.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1;
    await savePagesElsewhere(page, [...pages, { id, name }]);
    const res = await page.request.post('/api/bookmarks/add', {
        headers: writeHeaders,
        data: { page: id, bookmark: { name: 'Phone link', url, category: 'others' } },
    });
    expect(res.ok()).toBe(true);
    return id;
}

async function confirmDialog(page, label) {
    const button = page.locator('#config-confirm-modal button, #app-modal.show button').filter({ hasText: label }).last();
    await expect(button).toBeVisible({ timeout: 5_000 });
    await button.click();
}

const serverPages = (page) => page.evaluate(async () =>
    (await (await fetch('/api/pages', { cache: 'no-store' })).json()).map((p) => ({ id: Number(p.id), name: p.name })));

test.describe('the pages list in config', () => {
    test('a duplicate does not land on a page made elsewhere', async ({ page }) => {
        await pagesTab(page);
        const sourceId = await page.evaluate(() => Number(window.dashboardInstance.pages[0].id));

        const phoneId = await addPageElsewhere(page, 'Made on the phone', 'https://phone-only.example/');
        // This tab has not heard of it.
        expect(await page.evaluate((id) => window.dashboardInstance.pages.some((p) => Number(p.id) === id), phoneId)).toBe(false);

        await page.locator(`[data-page-duplicate="${sourceId}"]`).click();
        await confirmDialog(page, /duplicate/i);
        await confirmDialog(page, /with bookmarks/i);

        // The copy exists; then nothing more is coming.
        await expect.poll(async () => (await serverPages(page)).some((p) => /copy/i.test(p.name)), { timeout: 10_000 })
            .toBe(true);
        await page.waitForTimeout(1000);
        const after = await serverPages(page);
        expect(after.find((p) => p.id === phoneId)?.name).toBe('Made on the phone');
        const phoneRows = await page.evaluate(async (id) =>
            (await (await fetch(`/api/bookmarks?page=${id}`)).json()).map((b) => b.url), phoneId);
        expect(phoneRows).toEqual(['https://phone-only.example/']);
        expect(after.some((p) => p.id > phoneId && /copy/i.test(p.name))).toBe(true);
    });

    test('a rename made elsewhere survives a reorder here', async ({ page }) => {
        await pagesTab(page);
        // Two pages to swap, at least.
        if (await page.evaluate(() => window.dashboardInstance.pages.length) < 2) {
            await page.evaluate(() => window.dashboardInstance.config.addPage());
            await page.waitForFunction(() => window.dashboardInstance.pages.length >= 2);
        }
        const [first, second] = await page.evaluate(() => window.dashboardInstance.pages.slice(0, 2).map((p) => Number(p.id)));

        const current = await pagesElsewhere(page);
        await savePagesElsewhere(page, current.map((p) => (Number(p.id) === second ? { ...p, name: 'Renamed on the phone' } : p)));

        // Move the first page down, from this tab.
        await page.evaluate(() => window.dashboardInstance.config.render());
        await page.locator(`[data-page-move="down"][data-id="${first}"]`).click();

        await expect.poll(async () => (await serverPages(page)).map((p) => p.id).indexOf(first), { timeout: 10_000 })
            .toBeGreaterThan(0);
        expect((await serverPages(page)).find((p) => p.id === second)?.name).toBe('Renamed on the phone');
    });

    test('a page whose save fails is not left in the list', async ({ page }) => {
        await pagesTab(page);
        const before = await page.evaluate(() => window.dashboardInstance.pages.length);
        await page.route('**/api/pages', (route) => (route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'boom' })
            : route.fallback()));
        const refused = page.waitForResponse((r) => r.url().endsWith('/api/pages') && r.request().method() === 'POST');
        await page.locator('[data-page-add]').click();
        // The refused write, then a beat for what follows it.
        await refused;
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.dashboardInstance.pages.length)).toBe(before);
    });
});
