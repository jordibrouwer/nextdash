// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/*
 * Every block kind goes to another page the same way: the header menu's
 * "Move to page ▸" or Shift+Alt+←/→ on its title, landing last on the other
 * page, with one Undo that puts it back where it was.
 */

const block = (id) => `#dashboard-layout .category[data-category-id="${id}"]`;
const blockSel = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])';

async function seed(request, extra = {}) {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBeTruthy();
    expect((await request.post('/api/pages', {
        data: [{ id: 1, name: 'main' }, { id: 2, name: 'second' }], headers,
    })).ok()).toBeTruthy();
    expect((await request.post('/api/settings', {
        data: { quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: 'keep' }, ...extra }, headers,
    })).ok()).toBeTruthy();
}

async function openDashboard(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page, { extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'] });
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector(blockSel, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true);
    await page.waitForTimeout(1200);
}

const domOrder = (page) => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
const storedOrder = (page, pageId) => page.evaluate(async (id) => (await (await fetch(`/api/pages/${id}/blocks`)).json()).order, pageId);
const urlsOn = (page, pageId, category) => page.evaluate(async ({ id, category }) => {
    const body = await (await fetch(`/api/bookmarks?page=${id}`)).json();
    return (Array.isArray(body) ? body : body.bookmarks || [])
        .filter((b) => category == null || b.category === category).map((b) => b.url).sort();
}, { id: pageId, category });
/** Move a category to another page from the Bookmarks view's Structure modal. */
async function moveInStructureModal(page, fromPage, categoryId, toPage) {
    await page.locator('.config-view--library .lvs-header-actions [data-bm-header-more]').click();
    await page.locator('.config-view--library [data-bm-header-menu] [data-bm-open-structure]').click();
    const modal = page.locator('[data-structure-modal]');
    await modal.locator('[data-pt-tab="categories"]').click();
    const row = modal.locator(`[data-cat-row][data-cat-page="${fromPage}"][data-cat-id="${categoryId}"]`);
    await row.locator('[data-structure-more]').click();
    const menu = modal.locator('[data-structure-menu]');
    await menu.locator('[data-structure-action="move-page"]').click();
    await menu.locator('[data-structure-target]').selectOption(String(toPage));
    await menu.locator('[data-structure-confirm]').click();
}
const categoryIds = (page, pageId) => page.evaluate(async (id) => (await (await fetch(`/api/categories?page=${id}`)).json()).map((c) => c.id), pageId);

test.describe('moving a block to another page', () => {
    test.beforeEach(async ({ request }) => { await seed(request); });

    test('a category goes with its bookmarks through the header menu, and Undo brings both back', async ({ page }) => {
        await openDashboard(page);
        const before = await domOrder(page);
        const cats = await categoryIds(page, 1);
        const urls = await urlsOn(page, 1, 'media');
        expect(urls.length).toBeGreaterThan(0);

        await page.locator(`${block('media')} .category-title`).click({ button: 'right' });
        const menu = page.locator('#category-context-menu');
        await menu.locator('[data-action="move-page"]').click();
        await menu.locator('[data-action="2"]').click();

        await expect(page.locator(block('media'))).toHaveCount(0);
        const toast = page.locator('#app-notification.has-action').filter({ hasText: 'to second' });
        await expect(toast).toBeVisible();
        expect(await urlsOn(page, 2, 'media')).toEqual(urls);
        expect(await urlsOn(page, 1, 'media')).toEqual([]);
        expect(await categoryIds(page, 2)).toContain('media');
        expect((await storedOrder(page, 2)).at(-1)).toBe('media');

        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect(page.locator(block('media'))).toHaveCount(1);
        await expect.poll(() => domOrder(page)).toEqual(before);
        await expect.poll(() => urlsOn(page, 1, 'media')).toEqual(urls);
        expect(await urlsOn(page, 2, null)).toEqual([]);
        expect(await categoryIds(page, 1)).toEqual(cats);
        expect(await categoryIds(page, 2)).not.toContain('media');
    });

    test('a widget goes with Shift+Alt+→, keeps its width, and Undo brings it back in its place', async ({ page }) => {
        await openDashboard(page);
        const before = await domOrder(page);
        const stored = await storedOrder(page, 1);
        const wid = before.find((id) => id.startsWith('w_'));
        expect(wid).toBeTruthy();
        expect(await page.evaluate((id) => window.dashboardInstance.renderCore.setBlockWidth(id, 2), wid)).toBe(true);
        const storedWidget = (pageId) => page.evaluate(async ({ pageId, id }) => (await (await nextDashFetch(`/api/pages/${pageId}/blocks`)).json())
            .widgets.find((w) => w.id === id) || null, { pageId, id: wid });
        await page.locator(`${block(wid)} .category-title`).focus();
        await page.keyboard.press('Shift+Alt+ArrowRight');

        await expect(page.locator(block(wid))).toHaveCount(0);
        const toast = page.locator('#app-notification.has-action').filter({ hasText: 'to second' });
        await expect(toast).toBeVisible();
        expect((await storedOrder(page, 2)).at(-1)).toBe(wid);
        expect(await storedOrder(page, 1)).not.toContain(wid);
        expect((await storedWidget(2))?.config?.columns).toBe(2);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ControlOrMeta+z');
        await expect(page.locator(block(wid))).toHaveCount(1);
        await expect.poll(() => domOrder(page)).toEqual(before);
        await expect.poll(() => storedOrder(page, 1)).toEqual(stored);
        expect(await storedOrder(page, 2)).not.toContain(wid);
        await expect(page.locator(block(wid))).toHaveClass(/category--wide/);
        expect((await storedWidget(1))?.config?.columns).toBe(2);
    });

    test('a page switch while the move waits on the server leaves the new page its own widgets', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        expect((await request.put('/api/pages/2/blocks', {
            data: { widgets: [{ id: 'w_second', type: 'health', title: 'Second status' }] }, headers,
        })).ok()).toBeTruthy();
        await openDashboard(page);
        const wid = (await domOrder(page)).find((id) => id.startsWith('w_'));
        expect(wid).toBeTruthy();
        // Hold the write that takes the widget off page 1 until the reader
        // has gone to page 2.
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/pages/1/blocks', async (route) => {
            if (route.request().method() === 'PUT') await held;
            await route.continue();
        });
        await page.locator(`${block(wid)} .category-title`).focus();
        await page.keyboard.press('Shift+Alt+ArrowRight');
        // Landed on page 2 already; only the source write is held.
        await expect.poll(() => page.evaluate(async () => (await (await nextDashFetch('/api/pages/2/blocks')).json())
            .widgets.map((w) => w.id))).toContain(wid);
        await page.evaluate(() => window.dashboardInstance.requestPageNavigation(2));
        await expect(page.locator(block('w_second'))).toHaveCount(1);
        release();
        await expect(page.locator('#app-notification.has-action').filter({ hasText: 'to second' })).toBeVisible();
        await page.unroute('**/api/pages/1/blocks');

        const stored2 = await page.evaluate(async () => (await (await nextDashFetch('/api/pages/2/blocks')).json())
            .widgets.map((w) => w.id).sort());
        expect(stored2).toEqual(['w_second', wid].sort());
        await expect.poll(() => page.evaluate(() => Number(window.dashboardInstance.currentPageId))).toBe(2);
        await expect.poll(() => page.evaluate(() => (window.dashboardInstance.widgets || []).map((w) => w.id).sort()))
            .toEqual(stored2);
        await expect(page.locator(block('w_second'))).toHaveCount(1);
        await expect(page.locator(block(wid))).toHaveCount(1);
    });

    test('Undo from the page it went to takes it off that page, without a reload', async ({ page }) => {
        await openDashboard(page);
        const wid = (await domOrder(page)).find((id) => id.startsWith('w_'));
        await page.locator(`${block(wid)} .category-title`).focus();
        await page.keyboard.press('Shift+Alt+ArrowRight');
        const toast = page.locator('#app-notification.has-action').filter({ hasText: 'to second' });
        await expect(toast).toBeVisible();
        await page.evaluate(() => window.dashboardInstance.requestPageNavigation(2));
        await expect(page.locator(block(wid))).toHaveCount(1);
        await page.evaluate(() => [...document.querySelectorAll('#app-notification .app-notification-action, #app-notification button')]
            .find((b) => /undo/i.test(b.textContent || ''))?.click());
        await expect(page.locator(block(wid))).toHaveCount(0);
        expect(await storedOrder(page, 1)).toContain(wid);
    });

    test('Undo of a move on page 1 does nothing to page 2 once the reader went there', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        expect((await request.post('/api/categories?page=2', { data: [{ id: 'films', name: 'Films' }], headers })).ok()).toBeTruthy();
        expect((await request.post('/api/bookmarks/add', {
            data: { page: 2, bookmark: { name: 'Film', url: 'https://films.example/', category: 'films' } }, headers,
        })).ok()).toBeTruthy();
        await openDashboard(page);
        const order1 = (await domOrder(page)).filter((id) => !id.startsWith('__smart_'));
        const id = order1[0];
        await page.locator(`${block(id)} .category-title`).focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect(page.locator('#app-notification.show.has-action')).toContainText(`Moved`);
        await page.evaluate(() => window.dashboardInstance.requestPageNavigation(2));
        await expect(page.locator(block('films'))).toHaveCount(1);
        const order2 = await storedOrder(page, 2);
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ControlOrMeta+z');
        // Past both save debounces.
        await page.waitForTimeout(1500);
        expect(await categoryIds(page, 2)).toEqual(['films']);
        expect(await storedOrder(page, 2)).toEqual(order2);
        await expect(page.locator(block('films'))).toHaveCount(1);
        await expect(page.locator(block(id))).toHaveCount(0);
        // Page 1 kept the move: the Undo belonged to it and went with the page.
        expect((await storedOrder(page, 1)).filter((x) => !x.startsWith('__smart_')).indexOf(id)).toBe(1);
    });

    test('the Structure modal moves a category the same way, leaving a clashing category\'s own bookmarks alone', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        // Page 2 already uses the id "media" for a category of another name.
        expect((await request.post('/api/categories?page=2', { data: [{ id: 'media', name: 'Films' }], headers })).ok()).toBeTruthy();
        expect((await request.post('/api/bookmarks/add', {
            data: { page: 2, bookmark: { name: 'Film', url: 'https://films.example/', category: 'media' } }, headers,
        })).ok()).toBeTruthy();
        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        const urls = await urlsOn(page, 1, 'media');
        expect(urls.length).toBeGreaterThan(0);

        await moveInStructureModal(page, 1, 'media', 2);

        await expect.poll(() => urlsOn(page, 1, 'media')).toEqual([]);
        expect(await urlsOn(page, 2, 'media')).toEqual(['https://films.example/']);
        const landed = (await categoryIds(page, 2)).find((id) => id.startsWith('media-'));
        expect(landed).toBeTruthy();
        expect(await urlsOn(page, 2, landed)).toEqual(urls);
        expect((await storedOrder(page, 2)).at(-1)).toBe(landed);
        await expect(page.locator('#app-notification.has-action')).toContainText('to second');
    });

    test('a view over bookmarks (an unknown category) has no handle and does not move', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        expect((await request.post('/api/bookmarks/add', {
            data: { page: 1, bookmark: { name: 'Ghost', url: 'https://ghost.example/', category: 'ghostcat' } }, headers,
        })).ok()).toBeTruthy();
        await openDashboard(page);
        const ghost = page.locator(block('ghostcat'));
        await expect(ghost).toHaveCount(1);
        await expect(ghost.locator('button.category-reorder-handle, .category-reorder-handle[tabindex]')).toHaveCount(0);
        await expect(ghost.getByRole('button', { name: /^Move / })).toHaveCount(0);
        const before = await domOrder(page);
        expect(before).not.toContain('ghostcat');
        const prefix = await ghost.locator('.category-reorder-handle').boundingBox();
        await page.mouse.move(prefix.x + 2, prefix.y + 4);
        await page.mouse.down();
        await page.mouse.move(prefix.x + 60, prefix.y - 200, { steps: 4 });
        await expect(page.locator('.block-landing')).toHaveCount(0);
        await page.mouse.up();
        await ghost.locator('.category-title').focus();
        await page.keyboard.press('Alt+ArrowLeft');
        await page.waitForTimeout(300);
        await expect(page.locator('#app-notification.show').filter({ hasText: 'Moved' })).toHaveCount(0);
        expect(await domOrder(page)).toEqual(before);
        expect(await storedOrder(page, 1)).not.toContain('ghostcat');
    });

    test('a category whose bookmarks are partly on the other page already says it is on both now', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        await openDashboard(page);
        const urls = await urlsOn(page, 1, 'media');
        expect(urls.length).toBeGreaterThan(1);
        expect((await request.post('/api/bookmarks/add', {
            data: { page: 2, allowDuplicate: true, bookmark: { name: 'Taken', url: urls[0], category: '' } }, headers,
        })).ok()).toBeTruthy();
        await page.locator(`${block('media')} .category-title`).click({ button: 'right' });
        const menu = page.locator('#category-context-menu');
        await menu.locator('[data-action="move-page"]').click();
        await menu.locator('[data-action="2"]').click();
        await expect(page.locator('#app-notification')).toContainText('on both pages now');
        await expect.poll(() => urlsOn(page, 1, 'media')).toEqual([urls[0]]);
        expect(await urlsOn(page, 2, 'media')).toEqual(urls.slice(1));
        expect(await categoryIds(page, 1)).toContain('media');
        expect(await categoryIds(page, 2)).toContain('media');
    });

    test('Move to page ▸ is in the category menu and the widget menu', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${block('development')} .category-title`).click({ button: 'right' });
        await expect(page.locator('#category-context-menu [data-action="move-page"]')).toBeVisible();
        await page.keyboard.press('Escape');
        const wid = (await domOrder(page)).find((id) => id.startsWith('w_'));
        await page.locator(`${block(wid)} .category-title`).click({ button: 'right' });
        await expect(page.locator('#widget-context-menu [data-action="move-page"]')).toBeVisible();
    });

    test.describe('with Lock layout on', () => {
        test.beforeEach(async ({ request }) => { await seed(request, { lockLayout: true }); });

        test('the Structure modal still moves a category: it is maintenance, not the layout', async ({ page }) => {
            await openBookmarksWithHealth(page, undefined, { view: 'library' });
            const urls = await urlsOn(page, 1, 'media');
            await moveInStructureModal(page, 1, 'media', 2);
            await expect.poll(() => urlsOn(page, 2, 'media')).toEqual(urls);
            expect(await categoryIds(page, 1)).not.toContain('media');
        });

        test('Space on the handle says the layout is locked and picks nothing up', async ({ page }) => {
            await openDashboard(page);
            await page.locator(`${block('media')} .category-reorder-handle`).focus();
            await page.keyboard.press('Space');
            await expect(page.locator('#app-notification')).toContainText('Layout is locked');
            await expect(page.locator('.block-landing')).toHaveCount(0);
        });

        test('Shift+Alt+→ leaves the block where it is and says the layout is locked', async ({ page }) => {
            await openDashboard(page);
            await page.locator(`${block('media')} .category-title`).focus();
            await page.keyboard.press('Shift+Alt+ArrowRight');
            await expect(page.locator('#app-notification')).toContainText('Layout is locked');
            await expect(page.locator(block('media'))).toHaveCount(1);
            expect(await categoryIds(page, 2)).not.toContain('media');
        });
    });
});
