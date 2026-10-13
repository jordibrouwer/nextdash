// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');
const auth = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Config → Structure saves categories and finders as whole lists, from what
 * the tab read. Something made on another device since was not in that list
 * and went with the next edit here.
 *
 * "Another device" is page.request: it talks to the server from outside the
 * tab, so nothing in the tab hears of it.
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
    await page.goto(`/?_=${Date.now()}#config/structure`);
    await dismissBlockingOverlays(page);
    await page.locator(`[data-pt-tab="${tab}"]`).click();
}

async function confirmDelete(page) {
    const button = page.locator('#config-confirm-modal button, #app-modal.show button').filter({ hasText: /delete/i }).last();
    await expect(button).toBeVisible({ timeout: 5_000 });
    await button.click();
}

test.describe('Structure lists made elsewhere', () => {
    test('a category made elsewhere survives an edit here', async ({ page }) => {
        const id = await newPage(page, 'Fresh cats', [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]);
        await openStructureTab(page, 'categories');
        await page.waitForSelector(`#config-pt-body [data-cat-row][data-cat-page="${id}"]`, { timeout: 15_000 });

        const current = await (await page.request.get(`/api/categories?page=${id}`)).json();
        await page.request.post(`/api/categories?page=${id}`, { data: [...current, { id: 'phone', name: 'Phone' }], headers: auth });
        const added = await page.request.post('/api/bookmarks/add', {
            data: { page: id, bookmark: { name: 'Phone link', url: `https://fresh-cat-${Date.now()}.example/`, category: 'phone' } },
            headers: auth,
        });
        expect(added.ok()).toBe(true);

        const saved = page.waitForResponse((r) => r.url().includes(`/api/categories?page=${id}`) && r.request().method() === 'POST');
        await page.locator(`[data-cat-row][data-cat-page="${id}"][data-cat-id="alpha"] [data-cat-duplicate]`).click();
        expect((await saved).ok()).toBe(true);

        const ids = (await (await page.request.get(`/api/categories?page=${id}`)).json()).map((c) => c.id);
        expect(ids).toContain('phone');
        expect(ids).toContain('alpha');
        expect(ids.length).toBe(4);
    });

    test('a category deleted here stays deleted', async ({ page }) => {
        const id = await newPage(page, 'Fresh delete', [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]);
        await openStructureTab(page, 'categories');
        await page.waitForSelector(`#config-pt-body [data-cat-row][data-cat-page="${id}"]`, { timeout: 15_000 });

        const saved = page.waitForResponse((r) => r.url().includes(`/api/categories?page=${id}`) && r.request().method() === 'POST');
        await page.locator(`[data-cat-row][data-cat-page="${id}"][data-cat-id="beta"] [data-cat-delete]`).click();
        await confirmDelete(page).catch(() => {});
        expect((await saved).ok()).toBe(true);

        const ids = (await (await page.request.get(`/api/categories?page=${id}`)).json()).map((c) => c.id);
        expect(ids).toEqual(['alpha']);
    });

    test('a finder made elsewhere survives a delete here', async ({ page }) => {
        await page.request.post('/api/finders', {
            data: [
                { name: 'Keep', shortcut: 'fk', searchUrl: 'https://keep.example/?q=%s' },
                { name: 'Drop', shortcut: 'fd', searchUrl: 'https://drop.example/?q=%s' },
            ],
            headers: auth,
        });
        await openStructureTab(page, 'finders');
        await page.waitForSelector('#config-pt-body [data-finder-delete]', { timeout: 15_000 });

        const current = await (await page.request.get('/api/finders')).json();
        await page.request.post('/api/finders', {
            data: [...current, { name: 'Phone', shortcut: 'fp', searchUrl: 'https://phone.example/?q=%s' }],
            headers: auth,
        });

        const names = await page.locator('#config-pt-body [data-finder="name"]').evaluateAll((els) => els.map((e) => e.value));
        const saved = page.waitForResponse((r) => r.url().endsWith('/api/finders') && r.request().method() === 'POST');
        await page.locator(`#config-pt-body [data-finder-delete="${names.indexOf('Drop')}"]`).click();
        await confirmDelete(page);
        expect((await saved).ok()).toBe(true);

        const after = (await (await page.request.get('/api/finders')).json()).map((f) => f.name);
        expect(after).toContain('Keep');
        expect(after).toContain('Phone');
        expect(after).not.toContain('Drop');
    });
});
