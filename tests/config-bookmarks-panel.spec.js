// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-helpers');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

/** Capture page writes instead of storing them. */
async function capturePosts(page) {
    const posts = [];
    await page.route('**/api/bookmarks?page=*', async (route) => {
        if (route.request().method() === 'POST') {
            posts.push(JSON.parse(route.request().postData() || '[]'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fallback();
    });
    return posts;
}

async function focusFirstRow(page) {
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('j');
    return page.locator('#config-bm-list .config-bm-row.keyboard-selected').getAttribute('data-bm-key');
}

test.describe('the bookmark panel', () => {
    test('follows the row under the cursor', async ({ page }) => {
        await openBookmarks(page);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'empty');
        const first = await focusFirstRow(page);
        await expect(panel).toHaveAttribute('data-bm-panel-key', first);
        await page.keyboard.press('j');
        const second = await page.locator('#config-bm-list .config-bm-row.keyboard-selected').getAttribute('data-bm-key');
        await expect(panel).toHaveAttribute('data-bm-panel-key', second);
        const name = await page.evaluate((k) => window.dashboardInstance.config.findBookmarkByKey(k).name, second);
        await expect(panel.locator('[data-bm-field="name"]')).toHaveValue(name);
    });

    test('e jumps into the panel, and leaving a field saves it', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const name = page.locator('#config-bm-panel [data-bm-field="name"]');
        await expect(name).toBeFocused();
        await name.fill('Renamed from the panel');
        await page.keyboard.press('Tab');
        await expect.poll(() => posts.some((list) => list.some((b) => b.name === 'Renamed from the panel'))).toBe(true);
    });

    test('a failed save keeps what was typed and says so', async ({ page }) => {
        await page.route('**/api/bookmarks?page=*', async (route) => (route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'no' })
            : route.fallback()));
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const note = page.locator('#config-bm-panel [data-bm-field="note"]');
        await note.fill('will not save');
        await page.keyboard.press('Tab');
        const wrap = page.locator('#config-bm-panel [data-bm-field-wrap="note"]');
        await expect(wrap).toHaveClass(/is-error/);
        await expect(note).toHaveValue('will not save');
    });

    test('a shortcut someone else holds is refused', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const key = await focusFirstRow(page);
        const taken = await page.evaluate((k) => {
            const c = window.dashboardInstance.config;
            const other = c.dash.allBookmarks.find((b) => c.bookmarkKey(b) !== k);
            other.shortcut = 'ZQ';
            return other.shortcut;
        }, key);
        await page.keyboard.press('e');
        const field = page.locator('#config-bm-panel [data-bm-field="shortcut"]');
        await field.fill(taken);
        await page.keyboard.press('Tab');
        const wrap = page.locator('#config-bm-panel [data-bm-field-wrap="shortcut"]');
        await expect(wrap).toHaveClass(/is-error/);
        await expect(wrap).toContainText('ZQ');
        expect(posts.length).toBe(0);
    });

    test('i folds the panel away, and it stays folded after a reload', async ({ page }) => {
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('i');
        await expect(page.locator('#config-bm-workbench')).toHaveClass(/is-panel-collapsed/);
        await page.reload();
        await page.waitForSelector('#config-bm-workbench', { timeout: 15_000 });
        await expect(page.locator('#config-bm-workbench')).toHaveClass(/is-panel-collapsed/);
        await page.click('[data-bm-panel-toggle]');
        await expect(page.locator('#config-bm-workbench')).not.toHaveClass(/is-panel-collapsed/);
    });

    test('Edit in the right-click menu opens the panel, not a dialog', async ({ page }) => {
        await openBookmarks(page);
        const row = page.locator('#config-bm-list .config-bm-row').first();
        await row.click({ button: 'right' });
        await page.locator('.config-bm-context-menu [data-action="edit"], .config-bm-context-menu :text("Edit")').first().click();
        await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
        await expect(page.locator('#config-bm-panel [data-bm-field="name"]')).toBeFocused();
    });

    test('Escape in a field puts the old value back and returns to the list', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const name = page.locator('#config-bm-panel [data-bm-field="name"]');
        const before = await name.inputValue();
        await name.fill('typo');
        await page.keyboard.press('Escape');
        await expect(name).toHaveValue(before);
        await expect(page.locator('#config-bm-view, .config-view').first()).toBeVisible();
        expect(posts.length).toBe(0);
    });

    test('the tags field suggests known tags, and taking one saves nothing yet', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        await focusFirstRow(page);
        const tag = await page.evaluate(() => window.dashboardInstance.allBookmarks
            .flatMap((b) => b.tags || []).map((t) => String(t).toLowerCase()).find((t) => t.length > 2));
        test.skip(!tag, 'needs a tagged bookmark');
        await page.keyboard.press('e');
        const field = page.locator('#config-bm-panel [data-bm-field="tags"]');
        await field.click();
        await field.fill(tag.slice(0, 2));
        const items = page.locator('.tag-ac-dropdown .tag-ac-item');
        await expect(items.filter({ hasText: tag }).first()).toBeVisible();
        const first = await items.first().getAttribute('data-tag');
        await page.keyboard.press('Enter');
        await expect(field).toHaveValue(new RegExp(`${first}, $`));
        await expect(field).toBeFocused();
        expect(posts.length).toBe(0);
    });

    test('Monitor offers the interval, and choosing one saves it', async ({ page }) => {
        // Recorded and passed on: the mode has to be stored for the panel to
        // keep showing the interval after the refresh.
        const posts = [];
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() === 'POST') posts.push(JSON.parse(route.request().postData() || '[]'));
            return route.fallback();
        });
        await openBookmarks(page);
        const key = await focusFirstRow(page);
        const url = await page.evaluate((k) => window.dashboardInstance.config.findBookmarkByKey(k).url, key);
        await page.keyboard.press('e');
        const interval = page.locator('#config-bm-panel [data-bm-field="monitorInterval"]');
        await page.locator('#config-bm-panel [data-bm-field="checkMode"]').selectOption('off');
        await expect(interval).toBeHidden();
        await page.locator('#config-bm-panel [data-bm-field="checkMode"]').selectOption('monitor');
        await expect(interval).toBeVisible();
        await expect.poll(() => posts.some((list) => list.some((b) => b.url === url && b.monitor === true))).toBe(true);
        await interval.selectOption('60');
        await expect.poll(() => posts.some((list) => list.some((b) =>
            b.url === url && b.monitor === true && b.monitorIntervalMinutes === 60))).toBe(true);
    });
});
