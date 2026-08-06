// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Multi-select from the right mouse button.
 *
 * The keyboard route is undiscoverable by definition, so the context menu is
 * where a mouse-only user finds out that selecting is possible at all. Every
 * entry calls the same multiSelect methods the keyboard and the toolbar call —
 * these tests assert on the shared behaviour (what got selected, moved or
 * deleted), so a second implementation would fail them.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
}

const rows = (page) => page.locator('.bookmark-link[data-bookmark-index]');
const menuItems = (page) => page.locator('#bookmark-context-menu .move-popover-item');
const selectionCount = (page) =>
    page.evaluate(() => window.dashboardInstance.multiSelect.count());

async function openMenuOn(page, index) {
    await rows(page).nth(index).click({ button: 'right' });
    await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
}

/** Click a menu entry by its data-action id. */
async function clickAction(page, action) {
    await page.locator(`#bookmark-context-menu [data-action="${action}"]`).click();
}

/** Tick rows through the module, the way x/Shift+Z does. */
async function selectRows(page, indices) {
    await page.evaluate((idx) => {
        const ms = window.dashboardInstance.multiSelect;
        const all = [...document.querySelectorAll('.bookmark-link[data-bookmark-index]')];
        idx.forEach((i) => ms.toggleRow(all[i]));
    }, indices);
}

test.describe('multi-select from the context menu', () => {
    test('with no selection the menu offers Select and Select all in category', async ({ page }) => {
        await openDashboard(page);
        await openMenuOn(page, 0);

        const labels = await menuItems(page).allTextContents();
        // The single-row actions stay: with nothing ticked, right-click still
        // means "act on this bookmark".
        expect(labels.join('|')).toContain('Open in new tab');
        expect(labels.join('|')).toContain('Edit');
        // ...plus the two ways in.
        await expect(page.locator('[data-action="multi-start"]')).toHaveCount(1);
        await expect(page.locator('[data-action="multi-start-category"]')).toHaveCount(1);
    });

    test('the menu shows every entry without scrolling', async ({ page }) => {
        await openDashboard(page);
        await openMenuOn(page, 0);

        const geometry = await page.evaluate(() => {
            const menu = document.getElementById('bookmark-context-menu');
            const box = menu.getBoundingClientRect();
            const last = menu.querySelector('[data-action="multi-start-category"]');
            const lastBox = last.getBoundingClientRect();
            return {
                scrolls: menu.scrollHeight > menu.clientHeight + 1,
                lastInsideMenu: lastBox.bottom <= box.bottom + 1,
                lastInsideViewport: lastBox.bottom <= window.innerHeight,
            };
        });

        // The shared .move-popover cap was one item away from this menu's height,
        // so the two multi-select entries pushed it over: the last entries fell
        // below the fold behind a scrollbar. This is a fixed short list — it
        // sizes to its content.
        expect(geometry.scrolls).toBe(false);
        expect(geometry.lastInsideMenu).toBe(true);
        expect(geometry.lastInsideViewport).toBe(true);
    });

    test('the selecting entries sit above the destructive zone', async ({ page }) => {
        await openDashboard(page);
        await openMenuOn(page, 0);

        const order = await page.evaluate(() => {
            const menu = document.getElementById('bookmark-context-menu');
            // Children in document order: the name hint leads, so anything
            // matched by class alone has to be the divider specifically.
            return [...menu.children].map((el) => (
                el.getAttribute('data-action')
                || (el.classList.contains('move-popover-divider') ? '---divider---' : '')
            ));
        });

        const divider = order.indexOf('---divider---');
        // Delete opens the destructive zone the divider marks; a harmless
        // "Select" below that line reads as belonging to it.
        expect(divider).toBeGreaterThan(-1);
        expect(order.indexOf('multi-start')).toBeLessThan(divider);
        expect(order.indexOf('multi-start-category')).toBeLessThan(divider);
        expect(order.indexOf('delete')).toBeGreaterThan(divider);
    });

    test('the move popover keeps its own scroll cap', async ({ page }) => {
        await openDashboard(page);
        await openMenuOn(page, 0);
        await clickAction(page, 'move');
        await page.waitForSelector('#move-popover', { timeout: 10_000 });

        // The fix must not reach the popovers that share .move-popover and list
        // every category, page or tag — those are unbounded and must scroll.
        const style = await page.evaluate(() => {
            const cs = getComputedStyle(document.getElementById('move-popover'));
            return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
        });
        expect(style.overflowY).toBe('auto');
        expect(style.maxHeight).not.toBe('none');
    });

    test('Select ticks the row and shows the toolbar', async ({ page }) => {
        await openDashboard(page);
        await openMenuOn(page, 0);
        await clickAction(page, 'multi-start');

        expect(await selectionCount(page)).toBe(1);
        // The toolbar is the discovery payoff: it is what tells a mouse user
        // what a selection can do.
        await expect(page.locator('.multi-select-toolbar')).toBeVisible();
        await expect(page.locator('.bookmark-link.is-multi-selected')).not.toHaveCount(0);
    });

    test('Select all in category ticks the whole category', async ({ page }) => {
        await openDashboard(page);
        await openMenuOn(page, 0);
        await clickAction(page, 'multi-start-category');

        const inCategory = await page.evaluate(() => {
            const row = document.querySelector('.bookmark-link[data-bookmark-index]');
            return row?.closest('.bookmarks-list')
                ?.querySelectorAll('.bookmark-link[data-bookmark-index]').length ?? 0;
        });
        expect(inCategory).toBeGreaterThan(1);
        expect(await selectionCount(page)).toBe(inCategory);
    });

    test('right-clicking a selected row switches the menu to the selection', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);
        await openMenuOn(page, 0);

        const labels = (await menuItems(page).allTextContents()).join('|');
        // Counts are named, so it is unambiguous what the action will touch.
        expect(labels).toContain('2 selected');
        // The single-row actions are gone: offering "Delete" and "Delete 2
        // selected" together would point at two different sets in one list.
        expect(labels).not.toContain('Edit');
        expect(labels).not.toContain('Show in Health');
    });

    test('right-clicking an unselected row keeps the single-row menu', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);
        // Row 3 is not part of the selection, so the menu must act on it alone
        // rather than on rows the user did not point at.
        await openMenuOn(page, 3);

        const labels = (await menuItems(page).allTextContents()).join('|');
        expect(labels).toContain('Edit');
        expect(labels).not.toContain('2 selected');
    });

    test('Clear selection empties it', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);
        await openMenuOn(page, 0);
        await clickAction(page, 'multi-clear');

        expect(await selectionCount(page)).toBe(0);
        await expect(page.locator('.multi-select-toolbar')).toHaveCount(0);
    });

    test('Delete removes exactly the selected bookmarks', async ({ page }) => {
        await openDashboard(page);

        const before = await page.evaluate(
            () => window.dashboardInstance.bookmarks.map((b) => b.name)
        );
        await selectRows(page, [0, 1]);
        const picked = await page.evaluate(
            () => window.dashboardInstance.multiSelect.resolveRefs().map((r) => r.bookmark.name)
        );
        expect(picked).toHaveLength(2);

        await openMenuOn(page, 0);
        await clickAction(page, 'multi-delete');

        // Same confirmation the keyboard and toolbar routes get — the menu does
        // not get a shortcut around it.
        const confirmBtn = page.locator('#modal-actions button').first();
        await confirmBtn.waitFor({ state: 'visible', timeout: 10_000 });
        await confirmBtn.click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.bookmarks.length))
            .toBe(before.length - 2);

        const after = await page.evaluate(
            () => window.dashboardInstance.bookmarks.map((b) => b.name)
        );
        picked.forEach((name) => expect(after).not.toContain(name));
        before
            .filter((name) => !picked.includes(name))
            .forEach((name) => expect(after).toContain(name));
    });

    test('Move opens the same move popover the toolbar uses', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);
        await openMenuOn(page, 0);
        await clickAction(page, 'multi-move');

        // #move-popover is the shared element — a menu-specific copy would have
        // its own id and its own keyboard handling to drift.
        await expect(page.locator('#move-popover')).toBeVisible();
    });

    test('a single ticked row still gets the single-row menu', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0]);
        await openMenuOn(page, 0);

        // One bookmark is not a bulk operation: "Delete 1 selected" beside a
        // plain "Delete" would be two names for the same thing.
        const labels = (await menuItems(page).allTextContents()).join('|');
        expect(labels).toContain('Edit');
        expect(labels).not.toContain('1 selected');
    });
});
