// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');
const auth = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Config → Structure, three writes that went wrong:
 * - a duplicate whose categories failed stayed behind as an empty page;
 * - a category deleted on another device came back with the next edit here;
 * - two quick toggles sent two whole lists at once, and the older could land last.
 *
 * "Another device" is page.request: it talks to the server from outside the tab.
 */

async function newPage(page, name, categories) {
    const pages = await (await page.request.get('/api/pages')).json();
    const id = Math.max(0, ...pages.filter((p) => Number(p.id) < 999999).map((p) => Number(p.id) || 0)) + 1;
    await page.request.post('/api/pages', { data: [...pages, { id, name }], headers: auth });
    await page.request.post(`/api/categories?page=${id}`, { data: categories, headers: auth });
    return id;
}

async function openStructureTab(page, tab) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate((t) => {
        const c = window.dashboardInstance.config;
        c.ptTab = t;
        return c.openConfigView('structure');
    }, tab);
}

async function confirmDialog(page, label) {
    const button = page.locator('#config-confirm-modal button, #app-modal.show button').filter({ hasText: label }).last();
    await expect(button).toBeVisible({ timeout: 5_000 });
    await button.click();
}

test.describe('Structure review fixes', () => {
    test('a duplicate whose categories fail leaves no page behind', async ({ page }) => {
        const name = `Dup source ${Date.now()}`;
        const id = await newPage(page, name, [{ id: 'alpha', name: 'Alpha' }]);
        await openStructureTab(page, 'pages');
        await expect(page.locator(`[data-page-duplicate="${id}"]`)).toBeVisible({ timeout: 10_000 });

        // The copy's own categories write fails; the source's is left alone.
        await page.route((url) => url.pathname === '/api/categories' && url.searchParams.get('page') !== String(id), (route) => (
            route.request().method() === 'POST'
                ? route.fulfill({ status: 500, body: 'boom' })
                : route.continue()
        ));

        await page.locator(`[data-page-duplicate="${id}"]`).click();
        await confirmDialog(page, /duplicate/i);
        await confirmDialog(page, /with bookmarks/i);

        await expect(page.locator('.notification, .toast, [role="status"], [role="alert"]')
            .filter({ hasText: /could not duplicate/i }).first()).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await (await page.request.get('/api/pages')).json())
            .filter((p) => String(p.name).startsWith(`${name} copy`)).length, { timeout: 10_000 }).toBe(0);
        const trash = await (await page.request.get('/api/trash', { headers: auth })).json();
        expect((trash.items || []).filter((item) => item.kind === 'page' && String(item.pageName || '').startsWith(`${name} copy`))).toEqual([]);
    });

    test('a category deleted elsewhere stays deleted after an edit here', async ({ page }) => {
        const id = await newPage(page, `Gone elsewhere ${Date.now()}`, [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]);
        await openStructureTab(page, 'categories');
        await page.waitForSelector(`#config-pt-body [data-cat-row][data-cat-page="${id}"][data-cat-id="beta"]`, { timeout: 15_000 });

        await page.request.post(`/api/categories?page=${id}`, { data: [{ id: 'alpha', name: 'Alpha' }], headers: auth });

        const saved = page.waitForResponse((r) => r.url().includes(`/api/categories?page=${id}`) && r.request().method() === 'POST');
        await page.locator(`[data-cat-row][data-cat-page="${id}"][data-cat-id="alpha"] [data-cat-duplicate]`).click();
        expect((await saved).ok()).toBe(true);

        const ids = (await (await page.request.get(`/api/categories?page=${id}`)).json()).map((c) => c.id);
        expect(ids).toContain('alpha');
        expect(ids).not.toContain('beta');
        expect(ids.length).toBe(2);
    });

    test('two quick toggles end on the second', async ({ page }) => {
        const id = await newPage(page, `Toggle twice ${Date.now()}`, [{ id: 'alpha', name: 'Alpha' }]);
        await openStructureTab(page, 'categories');
        const toggle = page.locator(`[data-cat-row][data-cat-page="${id}"][data-cat-id="alpha"] [data-cat-spread]`);
        await expect(toggle).toBeVisible({ timeout: 15_000 });

        // The first save is slow on the wire; the second is not.
        let posts = 0;
        await page.route((url) => url.pathname === '/api/categories' && url.searchParams.get('page') === String(id), async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            posts += 1;
            if (posts === 1) await new Promise((resolve) => setTimeout(resolve, 1_500));
            return route.continue();
        });

        await toggle.click();
        await expect.poll(() => posts, { timeout: 5_000 }).toBe(1);
        await page.locator(`[data-cat-row][data-cat-page="${id}"][data-cat-id="alpha"] [data-cat-spread]`).click();
        await expect.poll(() => posts, { timeout: 10_000 }).toBe(2);

        const pressed = await page.locator(`[data-cat-row][data-cat-page="${id}"][data-cat-id="alpha"] [data-cat-spread]`).getAttribute('aria-pressed');
        expect(pressed).toBe('false');
        await expect.poll(async () => {
            const cats = await (await page.request.get(`/api/categories?page=${id}`)).json();
            return Boolean(cats.find((c) => c.id === 'alpha')?.spread);
        }, { timeout: 5_000 }).toBe(false);
        // Settled, not a moment before the slow one landed.
        await page.waitForTimeout(2_000);
        const cats = await (await page.request.get(`/api/categories?page=${id}`)).json();
        expect(Boolean(cats.find((c) => c.id === 'alpha')?.spread)).toBe(false);
    });
});
