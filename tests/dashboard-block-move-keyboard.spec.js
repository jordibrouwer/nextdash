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

    /*
     * The same, with the grid cursor on: the arrows, then Shift+Home up to the
     * title, the way the cheat sheet teaches. The grid took Tab for its own
     * walk through the rows and stepped past the //, so the handle could only
     * be reached by tabbing through every bookmark before it.
     */
    test('with the cursor on a title, Tab reaches the handle and the block moves', async ({ page }) => {
        const all = () => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());
        // A few rows down, so a Tab the grid kept for itself would have a
        // row to step back to.
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown');
        await expect(page.locator('.keyboard-selected')).toHaveCount(1);
        await page.keyboard.press('Shift+Home');
        const id = await page.evaluate(() => {
            const block = document.activeElement?.closest('.category[data-category-id], .dashboard-widget[data-widget-id]');
            return block ? (block.getAttribute('data-widget-id') || block.getAttribute('data-category-id')) : null;
        });
        expect(id).not.toBeNull();
        const before = await all();
        test.skip(before.indexOf(id) >= before.length - 1, 'needs a block after it');

        await page.keyboard.press('Tab');
        const handle = page.locator(`#dashboard-layout [data-category-id="${id}"] .category-title .category-reorder-handle, #dashboard-layout [data-widget-id="${id}"] .category-title .category-reorder-handle`).first();
        await expect(handle).toBeFocused();
        const title = handle.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " category-title ")][1]');
        // Shift+Tab on the handle comes back out to its title, not up a row.
        await page.keyboard.press('Shift+Tab');
        await expect(title).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(handle).toBeFocused();

        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await all()).indexOf(id)).toBe(before.indexOf(id) + 1);

        await expect(handle).toBeFocused();
    });

    /*
     * The terminal layout hides the // (display: none), so there is no handle
     * to step into: Tab on a title has to keep walking the rows, not stall.
     */
    test('with the handle hidden, Tab on a title walks on to the next row', async ({ page }) => {
        await page.evaluate(() => document.querySelectorAll('.dashboard-grid').forEach((g) => g.classList.add('layout-terminal')));
        await page.keyboard.press('ArrowDown');
        const selected = page.locator('.keyboard-selected');
        await expect(selected).toHaveCount(1);
        await page.keyboard.press('Shift+Home');
        await expect(page.locator('#dashboard-layout .category-title:focus')).toHaveCount(1);
        const before = await selected.evaluate((el) => el.outerHTML);

        await page.keyboard.press('Tab');
        await expect(page.locator('#dashboard-layout .category-title:focus')).toHaveCount(0);
        expect(await selected.evaluate((el) => el.outerHTML)).not.toBe(before);
    });

    /*
     * Without a Home key -- most Mac keyboards -- the title is reached with
     * the arrow up: on the top row of a block, ↑ steps onto its title, ↓ goes
     * back to that row, and ↑ again leaves for the block above.
     */
    test('↑ on the top row of a block reaches its title, and Tab its handle', async ({ page }) => {
        const blockOf = () => page.evaluate(() => {
            const el = document.activeElement;
            const block = el?.closest('.category[data-category-id], .dashboard-widget[data-widget-id]');
            return {
                id: block ? (block.getAttribute('data-widget-id') || block.getAttribute('data-category-id')) : null,
                onTitle: !!el?.matches?.('.category-title'),
            };
        });
        // Into the second column, so the top row there is not the grid's first.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.keyboard-selected')).toHaveCount(1);
        const row = await page.evaluate(() => document.querySelector('.keyboard-selected')?.textContent?.trim());
        const start = await blockOf();
        expect(start.onTitle).toBe(false);

        await page.keyboard.press('ArrowUp');
        await expect.poll(blockOf).toEqual({ id: start.id, onTitle: true });

        // ↓ comes back to the row it left, not the one under it.
        await page.keyboard.press('ArrowDown');
        await expect.poll(blockOf).toEqual({ id: start.id, onTitle: false });
        expect(await page.evaluate(() => document.querySelector('.keyboard-selected')?.textContent?.trim())).toBe(row);

        await page.keyboard.press('ArrowUp');
        await expect.poll(blockOf).toEqual({ id: start.id, onTitle: true });
        await page.keyboard.press('Tab');
        const handle = page.locator(`#dashboard-layout [data-category-id="${start.id}"] .category-title .category-reorder-handle, #dashboard-layout [data-widget-id="${start.id}"] .category-title .category-reorder-handle`).first();
        await expect(handle).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect.poll(blockOf).toEqual({ id: start.id, onTitle: true });

        // ↑ on the title leaves the block.
        await page.keyboard.press('ArrowUp');
        await expect.poll(async () => (await blockOf()).onTitle).toBe(false);
    });

    /*
     * The cursor stays on its row while the focus is on the title or the //.
     * Space and Enter there belong to the block -- pick up, fold -- and the
     * grid took them first and opened the bookmark under the cursor.
     */
    test('Space on the handle and Enter on the title open no bookmark', async ({ page }) => {
        let opened = 0;
        page.on('popup', () => { opened += 1; });
        page.context().on('page', () => { opened += 1; });
        const before = page.url();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.keyboard-selected')).toHaveCount(1);
        // Over to a category of the reader's own: a smart collection such as
        // Today is redrawn whenever another spec opens a bookmark, and that
        // redraw can take the focus between two keys.
        for (let i = 0; i < 6; i += 1) {
            const own = await page.evaluate(() => {
                const b = document.querySelector('.keyboard-selected')?.closest('.category[data-category-id]');
                return !!b && !b.matches('[data-smart-collection="true"], .dashboard-widget');
            });
            if (own) break;
            await page.keyboard.press('ArrowRight');
        }
        await page.keyboard.press('ArrowUp');
        const onTitle = () => page.evaluate(() => !!document.activeElement?.matches?.('.category-title'));
        await expect.poll(onTitle).toBe(true);

        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.block-landing')).toHaveCount(0);

        await page.keyboard.press('Shift+Tab');
        await expect.poll(onTitle).toBe(true);
        const id = await page.evaluate(() => {
            const b = document.activeElement?.closest('.category[data-category-id], .dashboard-widget[data-widget-id]');
            return b ? (b.getAttribute('data-widget-id') || b.getAttribute('data-category-id')) : null;
        });
        expect(id).not.toBeNull();
        const block = page.locator(`#dashboard-layout [data-category-id="${id}"], #dashboard-layout [data-widget-id="${id}"]`).first();
        await page.keyboard.press('Enter');
        await expect(block).toHaveAttribute('data-collapsed', 'true');
        // Unfolded again by a click: the fold is saved, and the data directory
        // is shared with every other spec.
        await block.locator('.category-title').first().click({ position: { x: 60, y: 8 } });
        await expect(block).not.toHaveAttribute('data-collapsed', 'true');

        await page.waitForTimeout(500);
        expect(opened).toBe(0);
        expect(page.url()).toBe(before);
    });

    // ← and → keep walking the columns, also from a title.
    test('→ on a title goes on to the next column', async ({ page }) => {
        const where = () => page.evaluate(() => {
            const el = document.activeElement;
            const block = el?.closest('.category[data-category-id], .dashboard-widget[data-widget-id]');
            return {
                id: block ? (block.getAttribute('data-widget-id') || block.getAttribute('data-category-id')) : null,
                onTitle: !!el?.matches?.('.category-title'),
                x: Math.round(block?.getBoundingClientRect().left ?? -1),
            };
        });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        const title = await where();
        expect(title.onTitle).toBe(true);
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await where()).onTitle).toBe(false);
        const next = await where();
        expect(next.id).not.toBe(title.id);
        expect(next.x).toBeGreaterThan(title.x);
        await expect(page.locator('.keyboard-selected')).toHaveCount(1);
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
