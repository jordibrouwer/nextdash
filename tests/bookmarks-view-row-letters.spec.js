// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithRows } = require('./config-bookmarks-helpers');

/**
 * The Bookmarks view speaks the dashboard's letters: with the cursor on a row, e
 * edits (the full dialog), t tags, m moves, p pins, f filters by its tag, s shares,
 * q shows a QR code; Shift is only for views. Shift+H switches the legend, and the
 * mode strip says what the keys do.
 */

const ROWS = [
    { name: 'Alpha', url: 'https://alpha.example', pageId: 1, tags: ['news'] },
    { name: 'Beta', url: 'https://beta.example', pageId: 1 },
];

async function cursorOnFirstRow(page) {
    await openBookmarksWithRows(page, ROWS);
    await page.locator('#config-bm-list').click();
    await page.keyboard.press('j');
    await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
}

test('e opens the full dialog', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.keyboard.press('e');
    await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
});

test('Shift+E does not open the dialog any more', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.keyboard.press('Shift+E');
    // Guards a check that nothing happens: without the pause the check passes at once.
    await page.waitForTimeout(400);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
});

test('m puts the cursor in the panel on the Page field', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.keyboard.press('m');
    await expect(page.locator('#config-bm-panel [data-bm-field="page"]')).toBeFocused();
});

test('p pins the bookmark', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.evaluate(() => {
        window.__saved = [];
        const c = window.dashboardInstance.config;
        c.saveBookmarkFields = async (key, patch) => { window.__saved.push(patch); return true; };
    });
    await page.keyboard.press('p');
    await expect.poll(() => page.evaluate(() => window.__saved)).toEqual([{ pinned: true }]);
});

test('f shows only the bookmark\'s tag', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.evaluate(() => {
        window.__tag = null;
        window.dashboardInstance.config.filterBookmarksByTag = (tag) => { window.__tag = tag; };
    });
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => window.__tag)).toBe('news');
});

test('s and q hand the row to share and the QR code', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.evaluate(() => {
        window.__acts = [];
        window.dashboardInstance.config.handleBookmarkMenuAction = (action) => { window.__acts.push(action); };
    });
    await page.keyboard.press('s');
    await page.keyboard.press('q');
    await expect.poll(() => page.evaluate(() => window.__acts)).toEqual(['share', 'qr']);
});

test('the legend shows the dashboard letters and Shift+H switches it', async ({ page }) => {
    await cursorOnFirstRow(page);
    const legend = page.locator('.config-bm-keyboard-legend');
    await expect(legend).toBeVisible();
    for (const k of ['e edit', 'm move to', 'p pin', 'f filter by tag', 'q QR code', 'Shift+H']) {
        await expect(legend).toContainText(k);
    }
    await page.keyboard.press('Shift+H');
    await expect(legend).toHaveCount(0);
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.config-bm-keyboard-legend')).toBeVisible();
});

test('the mode strip shows the cursor and the ticked rows, and goes with Esc', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await cursorOnFirstRow(page);
    const strip = page.locator('#mode-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Cursor');
    expect(await strip.locator('kbd').count()).toBeGreaterThan(2);
    await page.keyboard.press('x');
    await expect(strip).toContainText('1 selected');
    // Escape undoes the widest thing first: the ticks, then the panel, then the cursor.
    for (let i = 0; i < 5; i += 1) {
        if (!/Cursor|selected/.test(await strip.innerText().catch(() => ''))) break;
        await page.keyboard.press('Escape');
        // An Escape that only drops a tick leaves nothing new to wait on; give it a frame before the strip is read again.
        await page.waitForTimeout(200);
    }
    await expect(strip).toContainText('Browse');
});

test('the mode strip stays while the cursor walks the list and the page redraws', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await cursorOnFirstRow(page);
    const strip = page.locator('#mode-strip');
    await expect(strip).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.locator('.config-bm-row').nth(1)).toHaveClass(/keyboard-selected/);
    await expect(strip).toBeVisible();
    // The grid's own bookkeeping runs on a redraw; it must not clear the strip.
    await page.evaluate(() => window.dashboardInstance.keyboardNavigation.updateNavigableElements());
    await page.keyboard.press('k');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Cursor');
});

test('the Work through button names its key u', async ({ page }) => {
    await cursorOnFirstRow(page);
    const button = page.locator('[data-bm-work-through]');
    if (await button.count()) await expect(button.locator('kbd')).toHaveText('u');
});

test('the row menu shows the key beside each action, the dashboard menu\'s letters', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('#config-bm-context-menu');
    await expect(menu).toBeVisible();
    const keys = await menu.locator('[data-action]').evaluateAll((els) => Object.fromEntries(els.map((el) => [
        el.getAttribute('data-action'), el.querySelector('.move-popover-item-key')?.textContent || '',
    ])));
    expect(keys).toMatchObject({ share: 'S', qr: 'Q', edit: 'E', delete: 'D' });
    for (const chip of await menu.locator('.move-popover-item-key').allInnerTexts()) {
        expect(chip).not.toMatch(/Shift/);
    }
});

test('every action of the row menu has a key, and the key does it', async ({ page }) => {
    await cursorOnFirstRow(page);
    // The menu: every entry carries a chip.
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('#config-bm-context-menu');
    await expect(menu).toBeVisible();
    const missing = await menu.locator('[data-action]').evaluateAll((els) => els
        .filter((el) => !el.querySelector('.move-popover-item-key')).map((el) => el.getAttribute('data-action')));
    expect(missing, 'menu entries without a key').toEqual([]);
    await page.keyboard.press('Escape');
    // The keys: each reaches its action.
    await page.evaluate(() => {
        window.__acts = [];
        const c = window.dashboardInstance.config;
        c.openBookmarkByKey = (k, o) => window.__acts.push(`open:${o?.newTab ? 'tab' : 'same'}`);
        c.handleBookmarkMenuAction = (a) => window.__acts.push(a);
        c.filterBookmarksByCategory = () => window.__acts.push('category');
        c.filterBookmarksByPage = () => window.__acts.push('page');
        const menuObj = c.bookmarkContextMenu();
        const run = menuObj.run.bind(menuObj);
        menuObj.run = (a, ...rest) => { window.__acts.push(`menu:${a}`); return run(a, ...rest); };
    });
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('b');
    await page.keyboard.press('w');
    await page.keyboard.type('#');
    const acts = await page.evaluate(() => window.__acts);
    expect(acts).toEqual(expect.arrayContaining(['open:tab', 'copy-url', 'menu:filter-category', 'menu:filter-page', 'menu:find-tags-category']));
});

test('the legend lists the keys added for the row menu', async ({ page }) => {
    await cursorOnFirstRow(page);
    const legend = page.locator('.config-bm-keyboard-legend');
    for (const k of ['y / # find tags', 'b / w only this category / page', 'Ctrl/Cmd+Enter new tab', 'Ctrl/Cmd+C copy URL']) {
        await expect(legend).toContainText(k);
    }
});

test('the row menu draws no submenu arrow beside Checking', async ({ page }) => {
    await cursorOnFirstRow(page);
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('#config-bm-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.move-popover-submenu-caret')).toHaveCount(0);
    await expect(menu.locator('[data-action="check-mode"]')).toHaveAttribute('aria-haspopup', 'menu');
});

test('in the Bookmarks view the strip hides on a mouse click and returns with a key', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await cursorOnFirstRow(page);
    const strip = page.locator('#mode-strip');
    await expect(strip).toBeVisible();
    // A click on a row selects it by mouse: no strip.
    await page.locator('.config-bm-row').nth(1).locator('.config-bm-name, .config-bm-cell, td, div').first().click({ position: { x: 4, y: 4 } });
    await expect(strip).toBeHidden();
    await page.keyboard.press('k');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Cursor');
});

test('the Bookmarks view legend stays in view at the foot of the window', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 640 });
    const rows = Array.from({ length: 30 }, (_, i) => ({ name: `Row ${i}`, url: `https://row-${i}.example`, pageId: 1 }));
    await openBookmarksWithRows(page, rows);
    const legend = page.locator('.config-bm-keyboard-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toBeInViewport();
    const box = await legend.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(641);
});
