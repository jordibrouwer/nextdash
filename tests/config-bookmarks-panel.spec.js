// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData, WRITE_TOKEN } = require('./e2e-helpers');
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

/** A second page, over the API: fixture setup, not the thing under test. */
async function ensureSecondPage(page) {
    const pages = await (await page.request.get('/api/pages')).json();
    if (pages[1]) return String(pages[1].id);
    const maxId = Math.max(0, ...pages.map((p) => Number(p.id) || 0));
    const second = { id: maxId + 1, name: `Page ${maxId + 1}` };
    await page.request.post('/api/pages', {
        data: [...pages, second],
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    return String(second.id);
}

async function focusFirstRow(page) {
    // The list answers j with nothing focused; a click on its corner can land
    // under the sticky view header once the page has scrolled.
    await page.evaluate(() => document.activeElement?.blur?.());
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

    test('a folded panel shows pins in a column of their own', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 800 });
        await openBookmarks(page);
        const key = await focusFirstRow(page);
        await page.keyboard.press('e');
        await page.locator('#config-bm-panel [data-bm-field="pinned"]').check();
        await expect.poll(() => page.evaluate((k) =>
            window.dashboardInstance.config.findBookmarkByKey(k)?.pinned === true, key)).toBe(true);
        const row = page.locator(`#config-bm-list .config-bm-row[data-bm-key="${key}"]`);
        await expect(row.locator('.config-bm-pinned svg')).toBeHidden();
        await page.locator('#config-bm-panel [data-bm-panel-toggle]').click();
        await expect(page.locator('#config-bm-workbench')).toHaveClass(/is-panel-collapsed/);
        await expect(row.locator('.config-bm-pinned svg')).toBeVisible();
        await expect(row.locator('.config-bm-name .config-bm-pin')).toBeHidden();
    });

    test('a folded panel gives the rows more to show', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 800 });
        await openBookmarks(page);
        await focusFirstRow(page);
        const row = page.locator('#config-bm-list .config-bm-row').first();
        await expect(row.locator('.config-bm-checkmode')).toBeHidden();
        await page.keyboard.press('i');
        await expect(page.locator('#config-bm-workbench')).toHaveClass(/is-panel-collapsed/);
        await expect(row.locator('.config-bm-checkmode')).toBeVisible();
        await expect(row.locator('.config-bm-added')).toBeVisible();
        await page.keyboard.press('i');
        await expect(row.locator('.config-bm-checkmode')).toBeHidden();
        await expect(row.locator('.config-bm-added')).toBeHidden();
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

    test('Shift+E opens the full dialog, and the legend says so', async ({ page }) => {
        await openBookmarks(page);
        await expect(page.locator('.config-bm-keyboard-legend')).toContainText('Shift E');
        await expect(page.locator('.config-bm-keyboard-legend')).toContainText('edit in dialog');
        await focusFirstRow(page);
        await page.keyboard.press('Shift+E');
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
        await expect(page.locator('#config-bm-list')).toBeVisible();
    });

    test('a save leaves the next field focused, with what was typed into it', async ({ page }) => {
        const posts = [];
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            posts.push(JSON.parse(route.request().postData() || '[]'));
            // Slow enough that the typing below happens while the save runs.
            await new Promise((r) => setTimeout(r, 300));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        await page.locator('#config-bm-panel [data-bm-field="name"]').fill('Renamed while typing on');
        await page.keyboard.press('Tab');
        const url = page.locator('#config-bm-panel [data-bm-field="url"]');
        await expect(url).toBeFocused();
        await page.keyboard.press('End');
        await page.keyboard.type('/typed');
        await expect.poll(() => posts.length).toBeGreaterThan(0);
        // The save returns only once the refresh after it has repainted.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._bmPanelSaving)).toBe(null);
        await expect(url).toBeFocused();
        await expect(url).toHaveValue(/\/typed$/);
    });

    test('tags typed before clicking another row are saved to the first bookmark', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const first = await focusFirstRow(page);
        const url = await page.evaluate((k) => window.dashboardInstance.config.findBookmarkByKey(k).url, first);
        await page.keyboard.press('e');
        const field = page.locator('#config-bm-panel [data-bm-field="tags"]');
        await field.click();
        await page.keyboard.press('End');
        await page.keyboard.type(', zzclicked');
        const second = page.locator('#config-bm-list .config-bm-row').nth(1);
        const secondKey = await second.getAttribute('data-bm-key');
        await second.locator('.config-bm-title').click();
        await expect.poll(() => posts.some((list) => list.some((b) =>
            b.url === url && (b.tags || []).includes('zzclicked')))).toBe(true);
        // The save does not pull the panel back to the first bookmark.
        await expect(page.locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-key', secondKey);
    });

    test('moving to another page keeps the panel on the bookmark', async ({ page }) => {
        const target = await ensureSecondPage(page);
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const panel = page.locator('#config-bm-panel');
        const name = await panel.locator('[data-bm-field="name"]').inputValue();
        // Reached as a reader does, by focusing it; selectOption alone does not.
        await panel.locator('[data-bm-field="page"]').focus();
        await panel.locator('[data-bm-field="page"]').selectOption(target);
        await expect(panel).toHaveAttribute('data-bm-panel-key', new RegExp(`^${target}::`));
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'single');
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-bm-field="name"]')).toHaveValue(name);
        await expect(panel.locator('[data-bm-field="page"]')).toHaveValue(target);
        await expect(panel.locator('[data-bm-field="page"]')).toBeFocused();
        // The row has moved to its new page's group in the list.
        const key = await panel.getAttribute('data-bm-panel-key');
        const row = page.locator(`#config-bm-list .config-bm-row[data-bm-key="${key}"]`);
        await expect.poll(async () => {
            await page.locator('#config-bm-list').hover();
            await page.mouse.wheel(0, 2000);
            return row.count();
        }).toBe(1);
        const group = await row.evaluate((r) => {
            let el = r.previousElementSibling;
            while (el && !el.matches('.config-bm-group-head')) el = el.previousElementSibling;
            return el?.getAttribute('data-bm-group') || '';
        });
        expect(group.startsWith(`${target}::`)).toBe(true);
    });

    test('the header shows the whole name, and the dialog button its keys', async ({ page }) => {
        await openBookmarks(page);
        const key = await focusFirstRow(page);
        await page.keyboard.press('e');
        const panel = page.locator('#config-bm-panel');
        await panel.locator('[data-bm-field="name"]').fill('Cal');
        await page.keyboard.press('Tab');
        await expect(panel.locator('.config-bm-panel-title')).toHaveText('Cal');
        const title = panel.locator('.config-bm-panel-title');
        expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        expect(await title.textContent()).not.toContain('…');
        const edit = panel.locator('[data-bm-panel-action="edit-dialog"]');
        await expect(edit).toContainText('Shift');
        await expect(edit.locator('kbd')).toHaveText(['Shift', 'E']);
        await expect(edit).toHaveAttribute('title', /Shift\+E/);
        // Both actions stay inside the panel.
        const box = await panel.boundingBox();
        for (const btn of await panel.locator('.config-bm-panel-actions .config-btn').all()) {
            const b = await btn.boundingBox();
            expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
        }
        expect(key).toBeTruthy();
        await expect(page.locator('#config-bm-rail .config-bm-rail-item').first()).toHaveAttribute('title', /\S/);
    });

    test('changing the category keeps the panel on the bookmark', async ({ page }) => {
        await openBookmarks(page);
        const key = await focusFirstRow(page);
        await page.keyboard.press('e');
        const panel = page.locator('#config-bm-panel');
        const name = await panel.locator('[data-bm-field="name"]').inputValue();
        const select = panel.locator('[data-bm-field="category"]');
        const current = await select.inputValue();
        const values = await select.locator('option').evaluateAll((os) => os.map((o) => o.value));
        const next = values.find((v) => v !== current);
        test.skip(next === undefined, 'needs a second category option');
        const saved = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/bookmarks?page='));
        await select.focus();
        await select.selectOption(next);
        await saved;
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._bmPanelSaving)).toBe(null);
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'single');
        await expect(panel).toHaveAttribute('data-bm-panel-key', key);
        await expect(panel.locator('[data-bm-field="name"]')).toHaveValue(name);
        await expect(select).toHaveValue(next);
        await expect(select).toBeFocused();
    });
});
