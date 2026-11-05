// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * Plain letters act on the row under the cursor, the way they do in the Inbox.
 *
 * With the cursor on a bookmark, e m t p c d s q r v are its actions; Shift
 * never runs a row action. With no cursor the same letters are for the search
 * line, and in a text field they are characters.
 */

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
}

const inlineEditOpen = (page) => page.evaluate(() => Boolean(window.dashboardInstance.isInlineEditActive?.()));

async function cursorOnFirstRow(page) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()))
        .toBe(true);
}

test.describe('plain letters on a row', () => {
    test.beforeEach(async ({ page }) => {
        await load(page);
        await cursorOnFirstRow(page);
    });

    test('e opens the inline edit', async ({ page }) => {
        await page.keyboard.press('e');
        await expect.poll(() => inlineEditOpen(page), { timeout: 5000 }).toBe(true);
    });

    test('m opens the move popover', async ({ page }) => {
        await page.keyboard.press('m');
        await expect(page.locator('#move-popover')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('t opens the tag popover', async ({ page }) => {
        await page.keyboard.press('t');
        await expect(page.locator('#tag-popover')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('f filters by the row\'s tag, as plain t used to', async ({ page }) => {
        await page.evaluate(() => {
            window.__filtered = null;
            window.dashboardInstance.toggleTagFilter = (tag) => { window.__filtered = tag; };
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.navigableElements[kn.currentIndex].setAttribute('data-bookmark-tags', 'pw-only-tag');
        });
        await page.keyboard.press('f');
        await expect.poll(() => page.evaluate(() => window.__filtered), { timeout: 3000 }).toBe('pw-only-tag');
        await expect(page.locator('#tag-popover')).toHaveCount(0);
    });

    test('t opens the tag popover even on a row that has tags', async ({ page }) => {
        await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.navigableElements[kn.currentIndex].setAttribute('data-bookmark-tags', 'pw-only-tag');
        });
        await page.keyboard.press('t');
        await expect(page.locator('#tag-popover')).toBeVisible({ timeout: 3000 });
    });

    test('p pins and a second p unpins', async ({ page }) => {
        const pinned = () => page.evaluate(() =>
            !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()?.pinned);
        const before = await pinned();
        try {
            await page.keyboard.press('p');
            await expect.poll(pinned, { timeout: 5000 }).toBe(!before);
            await page.keyboard.press('p');
            await expect.poll(pinned, { timeout: 5000 }).toBe(before);
        } finally {
            if ((await pinned()) !== before) await page.keyboard.press('p');
        }
    });

    test('c opens the check-mode menu, and does not add a category', async ({ page }) => {
        await page.keyboard.press('c');
        await expect(page.locator('#bookmark-check-mode-menu')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.bookmark-inline-create.category-add-create')).toHaveCount(0);
    });

    test('d opens the delete popover and deletes nothing until it is confirmed', async ({ page }) => {
        const count = () => page.evaluate(() => (window.dashboardInstance.bookmarks || []).length);
        const before = await count();
        await page.keyboard.press('d');
        await expect(page.locator('#delete-popover')).toBeVisible({ timeout: 3000 });
        expect(await count()).toBe(before);
    });

    test('s hands the row to the share path', async ({ page }) => {
        await page.evaluate(() => {
            window.__shared = false;
            window.dashboardInstance.contextMenu.shareBookmark = async () => { window.__shared = true; };
        });
        await page.keyboard.press('s');
        await expect.poll(() => page.evaluate(() => window.__shared), { timeout: 5000 }).toBe(true);
    });

    test('q opens the QR code', async ({ page }) => {
        await page.keyboard.press('q');
        await expect(page.locator('#app-modal .modal.bookmark-qr-modal')).toBeVisible({ timeout: 5000 });
    });

    test('r reveals the bookmark in the Bookmarks view', async ({ page }) => {
        await page.keyboard.press('r');
        await expect(page.locator('.config-view--library')).toBeVisible({ timeout: 10_000 });
    });

    test('v toggles the preview card', async ({ page }) => {
        await page.evaluate(() => {
            window.__preview = 0;
            window.dashboardInstance.keyboardNavigation.togglePreviewCardForCurrent = () => { window.__preview += 1; };
        });
        await page.keyboard.press('v');
        await expect.poll(() => page.evaluate(() => window.__preview), { timeout: 3000 }).toBe(1);
    });

    test('a letter typed into a text field stays a character', async ({ page }) => {
        await page.evaluate(() => {
            const input = document.createElement('input');
            input.id = 'pw-field';
            document.body.appendChild(input);
            input.focus();
        });
        await page.keyboard.press('t');
        await expect(page.locator('#pw-field')).toHaveValue('t');
        await expect(page.locator('#tag-popover')).toHaveCount(0);
    });

    test('a bookmark shortcut on a row letter does not open from the grid', async ({ page }) => {
        await page.evaluate(() => {
            window.__opened = 0;
            const search = window.dashboardInstance.searchComponent;
            search.shortcuts.set('e', { name: 'pw-e', url: 'https://example.invalid/' });
            search.openBookmark = () => { window.__opened += 1; };
        });
        await page.keyboard.press('e');
        await expect.poll(() => inlineEditOpen(page), { timeout: 5000 }).toBe(true);
        expect(await page.evaluate(() => window.__opened)).toBe(0);
    });
});

test('with no cursor a letter starts the search, not an action', async ({ page }) => {
    await load(page);
    await page.keyboard.press('t');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tag-popover')).toHaveCount(0);
});

test('Shift+T with a row opens the tags of every bookmark and names T once', async ({ page }) => {
    await load(page);
    await cursorOnFirstRow(page);
    await page.evaluate(() => {
        window.__toasts = [];
        window.dashboardInstance.showNotification = (m) => { window.__toasts.push(String(m)); };
    });
    await page.keyboard.press('Shift+T');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 }).toBe('tags');
    await expect(page.locator('#tag-popover')).toHaveCount(0);
    expect(await page.evaluate(() => window.__toasts.some((m) => /press T/i.test(m)))).toBe(true);
});
