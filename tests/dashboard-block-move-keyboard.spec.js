// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

const blockSel = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])';

/** Ids of the blocks the reader can arrange, in the order they are shown. */
const movableOrder = (page) => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom()
    .filter((id) => document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(id)}"]`)
        ?.getAttribute('data-smart-collection') !== 'true'));

test.describe('moving blocks with the keyboard', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await markWhatsNewSeen(page, { extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'] });
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector(blockSel, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test('Space picks up, arrows move the box, Enter drops', async ({ page }) => {
        const order = await movableOrder(page);
        test.skip(order.length < 2, 'needs two movable blocks');
        const first = order[0];
        await page.locator(`${blockSel}[data-category-id="${first}"] .category-reorder-handle`).focus();
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#block-move-live')).toContainText('after');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await movableOrder(page))[1]).toBe(first);
        await expect(page.locator(`${blockSel}[data-category-id="${first}"] .category-reorder-handle`)).toBeFocused();
    });

    test('while a block is picked up the grid keys stay out of it', async ({ page }) => {
        const order = await movableOrder(page);
        test.skip(order.length < 2, 'needs two movable blocks');
        const handle = page.locator(`${blockSel}[data-category-id="${order[0]}"] .category-reorder-handle`);
        await handle.focus();
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp']) await page.keyboard.press(key);
        await expect(page.locator('.keyboard-selected')).toHaveCount(0);
        await expect(handle).toBeFocused();
        await page.keyboard.press('Escape');
    });

    test('Escape puts nothing anywhere', async ({ page }) => {
        const before = await movableOrder(page);
        await page.locator(`${blockSel} .category-reorder-handle`).first().focus();
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');
        await expect(page.locator('.block-landing')).toHaveCount(0);
        expect(await movableOrder(page)).toEqual(before);
    });

    test('Tab from the title reaches the handle, Space picks up', async ({ page }) => {
        const order = await movableOrder(page);
        const id = order[0];
        const block = page.locator(`${blockSel}[data-category-id="${id}"]`);
        await block.locator('.category-title').focus();
        await page.keyboard.press('Tab');
        const handle = block.locator('.category-reorder-handle');
        await expect(handle).toBeFocused();
        await expect(handle).toHaveAttribute('aria-label', /^Move /);
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.block-landing')).toHaveCount(0);
        // Collapse did not toggle from the key.
        await expect(block).not.toHaveAttribute('data-collapsed', 'true');
    });

    test('the handle shows focus in every header style', async ({ page }) => {
        const id = (await movableOrder(page))[0];
        const block = page.locator(`${blockSel}[data-category-id="${id}"]`);
        for (const style of ['theme', 'clean', 'underlined', 'boxed', 'label', 'group']) {
            await page.evaluate((v) => { document.body.dataset.catHead = v; }, style);
            await block.locator('.category-title').focus();
            await page.keyboard.press('Tab');
            const shown = await block.locator('.category-reorder-handle').evaluate((el) => {
                const own = getComputedStyle(el);
                const grip = getComputedStyle(el, '::before');
                const visible = (cs) => cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
                return el.matches(':focus-visible') && ((visible(own) && el.getBoundingClientRect().width > 0)
                    || (visible(grip) && grip.content !== 'none' && Number(grip.opacity) > 0.5));
            });
            expect(shown, style).toBe(true);
        }
    });

    test('Alt+Right moves a widget too', async ({ page }) => {
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({ widgets: [{ type: 'health', title: 'Status' }] }) });
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.dashboardInstance?.widgets?.length > 0, null, { timeout: 15_000 });
        await dismissBlockingOverlays(page);
        const widget = page.locator('#dashboard-layout .dashboard-widget').first();
        await expect(widget).toBeVisible();
        const id = await widget.getAttribute('data-widget-id');
        // Make room to move right: put the widget first.
        await page.evaluate(async (wid) => {
            const rc = window.dashboardInstance.renderCore;
            const order = rc.blockOrderFromDom().filter((b) => !b.startsWith('__smart_') && b !== wid);
            await rc.commitBlockMove({ id: wid, order: [wid, ...order], announce: false });
        }, id);
        const before = await movableOrder(page);
        expect(before.indexOf(id)).toBe(0);
        await widget.locator('.category-title').focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(async () => (await movableOrder(page)).indexOf(id)).toBe(1);
    });

    test('Alt+Right moves a category and Undo puts it back', async ({ page }) => {
        const before = await movableOrder(page);
        test.skip(before.length < 2, 'needs two movable blocks');
        const id = before[0];
        await page.locator(`${blockSel}[data-category-id="${id}"] .category-title`).focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(async () => (await movableOrder(page)).indexOf(id)).toBe(1);
    });
});
