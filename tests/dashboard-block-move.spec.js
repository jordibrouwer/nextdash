// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

const blockSel = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])';

async function openDashboard(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page, { extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'] });
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector(blockSel, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.DashboardBlockMover);
    // Widgets still load in after the first paint and move the blocks beneath them.
    await page.waitForTimeout(1200);
}

async function moveFirstToSecond(page) {
    await page.evaluate(async () => {
        const rc = window.dashboardInstance.renderCore;
        const order = rc.blockOrderFromDom();
        // The first block the reader can arrange: smart collections stay on top.
        const id = order.find((x) => !x.startsWith('__smart_'));
        await rc.commitBlockMove({ id, order: window.BlockMoveModel.insertAt(order, id, 2), width: null });
    });
}

test.describe('moving blocks on the dashboard', () => {
    test('the predicted rectangle is where the block ends up', async ({ page }) => {
        await openDashboard(page);
        const result = await page.evaluate(async () => {
            const grid = document.getElementById('dashboard-layout');
            const rc = window.dashboardInstance.renderCore;
            const order = rc.blockOrderFromDom();
            const id = order.find((x) => !x.startsWith('__smart_'));
            const target = window.BlockMoveModel.insertAt(order, id, 2);
            const predicted = window.DashboardBlockMover.predictRect(grid, target, id, 1);
            await rc.commitBlockMove({ id, order: target, width: null, announce: false });
            await new Promise((r) => setTimeout(r, 400));
            const el = grid.querySelector(`.category[data-category-id="${CSS.escape(id)}"]`);
            const g = grid.getBoundingClientRect();
            const b = el.getBoundingClientRect();
            return { predicted, actual: { x: b.left - g.left, y: b.top - g.top, w: b.width, h: b.height } };
        });
        for (const k of ['x', 'y', 'w', 'h']) {
            expect(Math.abs(result.predicted[k] - result.actual[k])).toBeLessThanOrEqual(2);
        }
    });

    test('undo puts order and width back in one step', async ({ page }) => {
        await openDashboard(page);
        const before = await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
        await moveFirstToSecond(page);
        const toast = page.locator('#app-notification.has-action').filter({ hasText: 'Moved' });
        await expect(toast).toBeVisible();
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom())).toEqual(before);
    });

    test('undo of a move with a width change restores order and width', async ({ page }) => {
        await openDashboard(page);
        const before = await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
        const wid = before.find((x) => x.startsWith('w_'));
        expect(wid).toBeTruthy();
        await page.evaluate(async (id) => {
            const rc = window.dashboardInstance.renderCore;
            const order = rc.blockOrderFromDom();
            await rc.commitBlockMove({ id, order: window.BlockMoveModel.insertAt(order, id, 3), width: 2 });
        }, wid);
        const toast = page.locator('#app-notification.has-action').filter({ hasText: '2 columns' });
        await expect(toast).toBeVisible();
        expect(await page.evaluate((id) => window.dashboardInstance.renderCore.blockWidth(id), wid)).toBe(2);
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom())).toEqual(before);
        await expect.poll(() => page.evaluate((id) => window.dashboardInstance.renderCore.blockWidth(id), wid)).toBe(1);
    });

    test('Cmd/Ctrl+Z undoes the last move while its notice is up', async ({ page }) => {
        await openDashboard(page);
        const before = await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
        await moveFirstToSecond(page);
        await expect(page.locator('#app-notification.has-action')).toBeVisible();
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom())).toEqual(before);
    });

    async function handleBox(page, index) {
        return page.locator(`${blockSel} .category-reorder-handle`).nth(index).boundingBox();
    }

    test('the page does not move while a block is carried', async ({ page }) => {
        await openDashboard(page);
        const rectsBefore = await page.evaluate(() => [...document.querySelectorAll('#dashboard-layout .category[data-category-id]')]
            .map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top]; }));
        const from = await handleBox(page, 0);
        const to = await page.locator(blockSel).nth(2).boundingBox();
        await page.mouse.move(from.x + 4, from.y + 4);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 8 });
        await expect(page.locator('.block-landing')).toBeVisible();
        const rectsDuring = await page.evaluate(() => [...document.querySelectorAll('#dashboard-layout .category[data-category-id]')]
            .map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top]; }));
        expect(rectsDuring).toEqual(rectsBefore);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('.block-landing')).toHaveCount(0);
    });

    test('the landing box is where the block lands', async ({ page }) => {
        await openDashboard(page);
        const id = await page.locator(blockSel).first().getAttribute('data-category-id');
        const from = await handleBox(page, 0);
        const to = await page.locator(blockSel).nth(2).boundingBox();
        await page.mouse.move(from.x + 4, from.y + 4);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 8 });
        // The box glides to its place; measure it once it is there.
        await page.waitForTimeout(300);
        const box = await page.locator('.block-landing').boundingBox();
        await page.mouse.up();
        await page.waitForTimeout(400);
        const landed = await page.locator(`#dashboard-layout .category[data-category-id="${id}"]`).boundingBox();
        expect(Math.abs(box.x - landed.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(box.y - landed.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(box.width - landed.width)).toBeLessThanOrEqual(2);
    });

    test('Escape and a drop outside the grid change nothing', async ({ page }) => {
        await openDashboard(page);
        const before = await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
        const from = await handleBox(page, 0);
        const to = await page.locator(blockSel).nth(2).boundingBox();
        await page.mouse.move(from.x + 4, from.y + 4);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 6 });
        await page.mouse.move(5, 5, { steps: 4 });
        await page.mouse.up();
        expect(await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom())).toEqual(before);
    });

    test('a seam makes the block wide, W turns it back', async ({ page }) => {
        await openDashboard(page);
        const from = await handleBox(page, 0);
        await page.mouse.move(from.x + 4, from.y + 4);
        await page.mouse.down();
        const seam = page.locator('.block-seam').first();
        const s = await seam.boundingBox();
        await page.mouse.move(s.x + s.width / 2, s.y + 60, { steps: 6 });
        await expect(page.locator('.block-landing')).toHaveAttribute('data-width', '2');
        await page.keyboard.press('w');
        await expect(page.locator('.block-landing')).toHaveAttribute('data-width', '1');
        await page.keyboard.press('Escape');
        await page.mouse.up();
    });

    test('W during a drag holds through the next small move', async ({ page }) => {
        await openDashboard(page);
        const from = await handleBox(page, 0);
        await page.mouse.move(from.x + 4, from.y + 4);
        await page.mouse.down();
        await page.mouse.move(from.x + 8, from.y + 6, { steps: 2 });
        const landing = page.locator('.block-landing');
        await expect(landing).toBeVisible();
        const was = await landing.getAttribute('data-width');
        const toggled = was === '2' ? '1' : '2';
        await page.keyboard.press('w');
        await expect(landing).toHaveAttribute('data-width', toggled);
        await page.mouse.move(from.x + 10, from.y + 6);
        await page.mouse.move(from.x + 10, from.y + 8);
        await expect(landing).toHaveAttribute('data-width', toggled);
        await page.keyboard.press('Escape');
        await page.mouse.up();
    });

    test('a jiggle on the handle of a spread category leaves it spread', async ({ page }) => {
        await openDashboard(page);
        const catSel = `${blockSel}:not(.dashboard-widget):not([data-widget-id])`;
        const id = await page.locator(catSel).first().getAttribute('data-category-id');
        await page.evaluate(async (cid) => {
            const rc = window.dashboardInstance.renderCore;
            await rc.setBlockWidth(cid, 2);
            rc.redrawKeepingPlace(cid);
        }, id);
        const width = () => page.evaluate((cid) => window.dashboardInstance.renderCore.blockWidth(cid), id);
        expect(await width()).toBe(2);
        await page.waitForTimeout(300);
        const orderBefore = await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
        const h = await page.locator(`${catSel}[data-category-id="${id}"] .category-reorder-handle`).boundingBox();
        await page.mouse.move(h.x + 4, h.y + 4);
        await page.mouse.down();
        await page.mouse.move(h.x + 6, h.y + 4);
        await page.mouse.up();
        await page.waitForTimeout(300);
        expect(await width()).toBe(2);
        expect(await page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom())).toEqual(orderBefore);
        await expect(page.locator('#app-notification.show').filter({ hasText: 'Moved' })).toHaveCount(0);
    });

    test('another pointer lifting or cancelling does not drop the carried block', async ({ page }) => {
        await openDashboard(page);
        const from = await handleBox(page, 0);
        const to = await page.locator(blockSel).nth(2).boundingBox();
        await page.mouse.move(from.x + 4, from.y + 4);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 6 });
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.evaluate(() => {
            const at = { bubbles: true, pointerType: 'touch', pointerId: 99, clientX: 5, clientY: 5 };
            document.dispatchEvent(new PointerEvent('pointerup', at));
            document.dispatchEvent(new PointerEvent('pointercancel', at));
        });
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('.block-landing')).toHaveCount(0);
    });

    test('a long press with touch carries the block and offers a width toggle', async ({ page }) => {
        await openDashboard(page);
        const from = await handleBox(page, 0);
        const to = await page.locator(blockSel).nth(2).boundingBox();
        await page.evaluate(({ x, y }) => {
            const h = document.querySelector('#dashboard-layout .category:not([data-smart-collection="true"]) .category-reorder-handle');
            h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, button: 0, clientX: x, clientY: y }));
        }, { x: from.x + 4, y: from.y + 4 });
        await page.waitForTimeout(450);
        await page.evaluate(({ x, y }) => {
            document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y }));
        }, { x: to.x + to.width * 0.75, y: to.y + 20 });
        await expect(page.locator('.block-landing')).toBeVisible();
        await expect(page.locator('.block-landing-width')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.block-landing')).toHaveCount(0);
    });

    test('a touch that moves before the press is long enough does not carry', async ({ page }) => {
        await openDashboard(page);
        const from = await handleBox(page, 0);
        await page.evaluate(({ x, y }) => {
            const h = document.querySelector('#dashboard-layout .category:not([data-smart-collection="true"]) .category-reorder-handle');
            h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, button: 0, clientX: x, clientY: y }));
            document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x + 30, clientY: y + 30 }));
        }, { x: from.x + 4, y: from.y + 4 });
        await page.waitForTimeout(500);
        await expect(page.locator('.block-landing')).toHaveCount(0);
    });

    test('with the layout locked a block cannot be picked up', async ({ page }) => {
        await openDashboard(page);
        const setLock = (value) => page.evaluate(async (v) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const current = await (await api('/api/settings')).json();
            current.lockLayout = v;
            await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) });
        }, value);
        await setLock(true);
        try {
            await openDashboard(page);
            await expect(page.locator('body.layout-locked')).toHaveCount(1);
            const from = await handleBox(page, 0);
            const to = await page.locator(blockSel).nth(2).boundingBox();
            await page.mouse.move(from.x + 4, from.y + 4);
            await page.mouse.down();
            await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 6 });
            await expect(page.locator('.block-landing')).toHaveCount(0);
            await page.mouse.up();
        } finally {
            await setLock(false);
        }
    });
});
