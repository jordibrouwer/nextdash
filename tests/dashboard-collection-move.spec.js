// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');

/*
 * Collections are blocks like categories and widgets: placed per page, wide
 * or not, and movable to another page. Stale is the built-in one a fresh
 * install can show without seeding history (nothing has been opened yet);
 * "Mine" is a user collection matching the two video bookmarks.
 */

const STALE = '__smart_stale__';
const MINE = 'custom:mine';
const block = (id) => `#dashboard-layout .category[data-category-id="${id}"]`;

async function seed(request, extra = {}) {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBeTruthy();
    expect((await request.post('/api/pages', {
        data: [{ id: 1, name: 'main' }, { id: 2, name: 'second' }], headers,
    })).ok()).toBeTruthy();
    expect((await request.post('/api/settings', {
        data: {
            quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: 'keep' },
            // Today fills itself from the time of day; off, the page is the same at any hour.
            showSmartTodayCollection: false,
            showSmartStaleCollection: true,
            collections: [{ id: 'mine', name: 'Mine', logic: 'or', rules: [{ field: 'tag', operator: 'includes', value: 'video' }] }],
            ...extra,
        },
        headers,
    })).ok()).toBeTruthy();
}

async function openDashboard(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page, { extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'] });
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector(block(STALE), { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.DashboardBlockMover && window.dashboardInstance?._bookmarksReady === true);
    // Widgets load in after the first paint and move the blocks beneath them.
    await page.waitForTimeout(1200);
}

const domOrder = (page) => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
const storedOrder = (page, pageId = 1) => page.evaluate(async (id) => (await (await fetch(`/api/pages/${id}/blocks`)).json()).order, pageId);
const settings = (page) => page.evaluate(async () => (await fetch('/api/settings')).json());

test.describe('collections move like any other block', () => {
    test.beforeEach(async ({ request }) => { await seed(request); });

    test('dragging // of a collection past a category saves its place, and it survives a reload', async ({ page }) => {
        await openDashboard(page);
        const before = await domOrder(page);
        expect(before.indexOf(STALE)).toBe(0);
        const handle = await page.locator(`${block(STALE)} .category-reorder-handle`).boundingBox();
        const target = await page.locator(`${block('media')}`).boundingBox();
        await page.mouse.move(handle.x + 4, handle.y + 4);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width * 0.4, target.y + target.height * 0.75, { steps: 10 });
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.mouse.up();
        await expect.poll(async () => (await domOrder(page)).indexOf(STALE)).toBeGreaterThan(0);
        const moved = await domOrder(page);
        await expect.poll(async () => (await storedOrder(page)).indexOf(STALE)).toBeGreaterThan(-1);
        await openDashboard(page);
        expect(await domOrder(page)).toEqual(moved);
    });

    test('Alt+→ on a collection title moves it one place', async ({ page }) => {
        await openDashboard(page);
        const before = await domOrder(page);
        await page.locator(`${block(STALE)} .category-title`).focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(async () => (await domOrder(page)).indexOf(STALE)).toBe(1);
        expect((await domOrder(page))[0]).toBe(before[1]);
        await expect(page.locator('#app-notification.has-action')).toContainText('Moved');
    });

    test('Space picks a collection up, W makes it two columns, and both survive a reload', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${block(MINE)} .category-reorder-handle`).focus();
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('w');
        await expect(page.locator('.block-landing')).toHaveAttribute('data-width', '2');
        await page.keyboard.press('Enter');
        await expect(page.locator(block(MINE))).toHaveClass(/category--wide/);
        await expect(page.locator('#app-notification.has-action')).toContainText('2 columns');
        const order = await domOrder(page);
        await expect.poll(async () => (await settings(page)).collectionColumns?.[MINE]).toBe(2);
        await expect.poll(async () => (await storedOrder(page)).indexOf(MINE)).toBe(order.indexOf(MINE));
        await openDashboard(page);
        await expect(page.locator(block(MINE))).toHaveClass(/category--wide/);
        expect(await domOrder(page)).toEqual(order);
    });

    test('dropped on the line between two columns, a collection is wide', async ({ page }) => {
        await openDashboard(page);
        const handle = await page.locator(`${block(STALE)} .category-reorder-handle`).boundingBox();
        await page.mouse.move(handle.x + 4, handle.y + 4);
        await page.mouse.down();
        const seam = await page.locator('.block-seam').first().boundingBox();
        await page.mouse.move(seam.x + seam.width / 2, handle.y + 30, { steps: 8 });
        await expect(page.locator('.block-landing')).toHaveAttribute('data-width', '2');
        await page.mouse.up();
        await expect(page.locator(block(STALE))).toHaveClass(/category--wide/);
        await expect.poll(async () => (await settings(page)).collectionColumns?.[STALE]).toBe(2);
    });

    test('Shift+W on a collection title makes it two columns, and back', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${block(MINE)} .category-title`).focus();
        await page.keyboard.press('Shift+W');
        await expect(page.locator(block(MINE))).toHaveClass(/category--wide/);
        await expect.poll(async () => (await settings(page)).collectionColumns?.[MINE]).toBe(2);
        await page.locator(`${block(MINE)} .category-title`).focus();
        await page.keyboard.press('Shift+W');
        await expect(page.locator(block(MINE))).not.toHaveClass(/category--wide/);
        await expect.poll(async () => (await settings(page)).collectionColumns?.[MINE]).toBeUndefined();
    });

    test('the collection menu\'s width entry makes it two columns', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${block(STALE)} .category-title`).click({ button: 'right' });
        await page.locator('#collection-context-menu [data-action="width"]').click();
        await expect(page.locator(block(STALE))).toHaveClass(/category--wide/);
        await expect.poll(async () => (await settings(page)).collectionColumns?.[STALE]).toBe(2);
    });

    test('Move to page ▸ shows it only on that page; Undo brings it back', async ({ page }) => {
        await openDashboard(page);
        // A place of its own first, so Undo has an order to put back.
        await page.locator(`${block(STALE)} .category-title`).focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(async () => (await storedOrder(page)).indexOf(STALE)).toBe(1);
        const before = await domOrder(page);

        await page.locator(`${block(STALE)} .category-title`).click({ button: 'right' });
        const menu = page.locator('#collection-context-menu');
        await menu.locator('[data-action="move-page"]').click();
        await menu.locator('[data-action="2"]').click();

        await expect(page.locator(block(STALE))).toHaveCount(0);
        const toast = page.locator('#app-notification.has-action').filter({ hasText: 'to second' });
        await expect(toast).toBeVisible();
        // The name, not the count it carries in its header.
        await expect(toast).not.toContainText('(');
        await expect.poll(async () => (await settings(page)).smartStalePageIds).toEqual([2]);
        expect(await storedOrder(page, 2)).toContain(STALE);
        expect((await storedOrder(page, 2)).at(-1)).toBe(STALE);

        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect(page.locator(block(STALE))).toHaveCount(1);
        await expect.poll(() => domOrder(page)).toEqual(before);
        await expect.poll(async () => (await settings(page)).smartStalePageIds).toEqual([]);
        await expect.poll(async () => (await storedOrder(page)).indexOf(STALE)).toBe(1);
    });

    test('a moved collection shows on the target page and nowhere else', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${block(MINE)} .category-title`).click({ button: 'right' });
        const menu = page.locator('#collection-context-menu');
        await menu.locator('[data-action="move-page"]').click();
        await menu.locator('[data-action="2"]').click();
        await expect(page.locator(block(MINE))).toHaveCount(0);
        await expect.poll(async () => (await settings(page)).collections?.[0]?.pageIds).toEqual([2]);
        await page.evaluate(() => window.dashboardInstance.requestPageNavigation(2));
        await expect(page.locator(block(MINE))).toHaveCount(1);
        await page.evaluate(() => window.dashboardInstance.requestPageNavigation(1));
        await expect(page.locator(block(STALE))).toHaveCount(1);
        await expect(page.locator(block(MINE))).toHaveCount(0);
    });

    test('Shift+Alt+→ on a collection title moves it to the next page', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${block(STALE)} .category-title`).focus();
        await page.keyboard.press('Shift+Alt+ArrowRight');
        await expect(page.locator(block(STALE))).toHaveCount(0);
        await expect(page.locator('#app-notification.has-action')).toContainText('to second');
        await expect.poll(async () => (await settings(page)).smartStalePageIds).toEqual([2]);
    });

    test('Lock layout keeps a collection where it is', async ({ page, request }) => {
        await seed(request, { lockLayout: true });
        await openDashboard(page);
        const before = await domOrder(page);
        await page.locator(`${block(STALE)} .category-title`).focus();
        await page.keyboard.press('Alt+ArrowRight');
        await page.keyboard.press('Shift+Alt+ArrowRight');
        await page.locator(`${block(STALE)} .category-reorder-handle`).focus();
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toHaveCount(0);
        await page.locator(`${block(STALE)} .category-title`).click({ button: 'right' });
        await expect(page.locator('#collection-context-menu [data-action="move-page"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        expect(await domOrder(page)).toEqual(before);
        expect((await settings(page)).smartStalePageIds).toEqual([]);
    });

    test('a tag collection moves on its page but not to another', async ({ page, request }) => {
        await seed(request, { showTagCollections: true, tagCollectionsMinCount: 4 });
        await openDashboard(page);
        const tag = block('tag:dev');
        await expect(page.locator(tag)).toHaveCount(1);
        await page.locator(`${tag} .category-title`).focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(async () => (await storedOrder(page)).includes('tag:dev')).toBe(true);
        await page.locator(`${tag} .category-title`).focus();
        await page.keyboard.press('Shift+Alt+ArrowRight');
        await expect(page.locator(tag)).toHaveCount(1);
        // The answer takes the place of the move's "Moved … Undo" at once. It
        // used to queue behind it and show 4.8 s after the press.
        await expect(page.locator('#dashboard-kbd-selection-live')).toContainText('follows its tag');
        await expect(page.locator('#app-notification')).toContainText('follows its tag', { timeout: 1_500 });
        await page.locator(`${tag} .category-title`).click({ button: 'right' });
        await expect(page.locator('#collection-context-menu')).toBeVisible();
        await expect(page.locator('#collection-context-menu [data-action="move-page"]')).toHaveCount(0);
    });
});
