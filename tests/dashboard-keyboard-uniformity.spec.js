// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The dashboard's keys, checked as one family rather than one at a time.
 *
 * Every case here is a place where two keys used to disagree with each other:
 * arrows moved the highlight but j/k did not, a category header could only be
 * reached with Tab, Delete deleted a bookmark but opened a menu on a category,
 * and the right-click menu offered eleven actions with a key each while showing
 * none of them.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const cursor = (page) => page.evaluate(
    () => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1);

async function selectFirstRow(page) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => cursor(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
}

test.describe('j and k move the highlight', () => {
    test('j goes down and k comes back, exactly as the arrows do', async ({ page }) => {
        await openDashboard(page);
        await selectFirstRow(page);
        const start = await cursor(page);

        await page.keyboard.press('j');
        await expect.poll(() => cursor(page), { timeout: 5000 }).toBe(start + 1);

        await page.keyboard.press('k');
        await expect.poll(() => cursor(page), { timeout: 5000 }).toBe(start);
    });
});

test.describe('Shift+Home reaches the category header', () => {
    test('focus lands on the header of the category the cursor is in', async ({ page }) => {
        await openDashboard(page);
        await selectFirstRow(page);

        const expected = await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            const row = kn.navigableElements[kn.currentIndex];
            return row?.closest('.category[data-category-id]')?.getAttribute('data-category-id') || null;
        });
        test.skip(expected === null, 'first row is not inside a stored category');

        await page.keyboard.press('Shift+Home');
        await expect.poll(() => page.evaluate(() => {
            const active = document.activeElement;
            if (!active?.classList?.contains('category-title')) return null;
            return active.closest('.category[data-category-id]')?.getAttribute('data-category-id') || null;
        }), { timeout: 5000 }).toBe(expected);
    });
});

test.describe('the category header answers to the same keys as a bookmark row', () => {
    test('Delete asks to delete the category instead of opening the menu', async ({ page }) => {
        await openDashboard(page);
        await selectFirstRow(page);
        await page.keyboard.press('Shift+Home');
        await expect(page.locator('.category-title:focus')).toHaveCount(1);

        await page.keyboard.press('Delete');
        // The confirm is the menu's own, so the deletion has one implementation
        // whichever route asked for it.
        await expect(page.locator('#app-modal.show')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#category-context-menu')).toHaveCount(0);
    });

    test('Shift+F10 opens the menu, beside the header rather than in the corner', async ({ page }) => {
        await openDashboard(page);
        await selectFirstRow(page);
        await page.keyboard.press('Shift+Home');
        await expect(page.locator('.category-title:focus')).toHaveCount(1);

        await page.keyboard.press('Shift+F10');
        const menu = page.locator('#category-context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });

        const box = await menu.boundingBox();
        expect(box).not.toBeNull();
        // A keyboard-raised contextmenu carries no pointer position; taken at
        // face value the menu pinned itself to 0,0.
        expect(box.x + box.y).toBeGreaterThan(0);
    });
});

test.describe('Shift+W acts on the category you are in, or on none at all', () => {
    test('with the cursor nowhere, no category changes', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
            document.activeElement instanceof HTMLElement && document.activeElement.blur();
        });
        const before = await page.evaluate(() => [...document.querySelectorAll(
            '#dashboard-layout .category[data-category-id]')].map((el) => el.getAttribute('data-spread') || ''));

        await page.keyboard.press('Shift+W');
        await page.waitForTimeout(400);

        const after = await page.evaluate(() => [...document.querySelectorAll(
            '#dashboard-layout .category[data-category-id]')].map((el) => el.getAttribute('data-spread') || ''));
        expect(after).toEqual(before);
    });
});

test.describe('the right-click menu shows the key beside the action', () => {
    test('entries carry a chip and an aria-keyshortcuts of the same key', async ({ page }) => {
        await openDashboard(page);
        const row = page.locator('#dashboard-layout .bookmark-link').first();
        await row.click({ button: 'right' });

        const menu = page.locator('#bookmark-context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });

        const edit = menu.locator('[data-action="edit"]');
        await expect(edit.locator('kbd.move-popover-item-key')).toHaveText('Shift+E');
        await expect(edit).toHaveAttribute('aria-keyshortcuts', 'Shift+E');

        // The chip is decoration for a screen reader — the item's own label
        // already says what it does, and aria-keyshortcuts carries the key.
        await expect(edit.locator('kbd.move-popover-item-key')).toHaveAttribute('aria-hidden', 'true');

        const delete_ = menu.locator('[data-action="delete"]');
        await expect(delete_.locator('kbd.move-popover-item-key')).toHaveText('Delete');
    });
});

test.describe('the keys are announced where the button is', () => {
    test('page tabs carry their digit, and the header buttons their chord', async ({ page }) => {
        await openDashboard(page);

        const firstTab = page.locator('#page-navigation .page-nav-btn:not([data-view-tab])').first();
        await expect(firstTab).toHaveAttribute('aria-keyshortcuts', '1');

        const config = page.locator('.config-link-anchor');
        if (await config.count()) {
            await expect(config).toHaveAttribute('aria-keyshortcuts', 'Shift+S');
        }
    });
});
