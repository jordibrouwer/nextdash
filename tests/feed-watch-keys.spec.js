// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

/**
 * Keys for watched feeds: Shift+Alt+W watches the focused bookmark's feed,
 * Shift+N opens the paper, j / k read inside it. Real key presses; the
 * watch routes are stubbed with one watched bookmark and three unread items.
 */
test.describe.configure({ mode: 'serial' });

let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');

async function setup(page, { watched = true } = {}) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = [1, 2, 3].map((n) => ({
        ...newsItem(n), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    const list = watched ? watchPayload(key, items) : { limit: 100, total: 0, watches: {} };
    await stubWatch(page, { list, items: watched ? items : [] });
    await openDashboard(page);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.feedWatch?.byKey?.size || 0)).toBe(watched ? 1 : 0);
}

test('Shift+Alt+W on a focused bookmark opens the feed picker for it', async ({ page }) => {
    await setup(page, { watched: false });
    // The arrow keys start the cursor on the grid, as for every row action
    // (the first stop is the bookmark's copy in the Today collection).
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.keyboard-selected')).toHaveAttribute('data-bookmark-url', site.url);
    await page.keyboard.press('Shift+Alt+KeyW');
    await expect(page.locator('[data-feed-watch-picker]')).toBeVisible();
});

test('Shift+Alt+W with no bookmark in hand does nothing', async ({ page }) => {
    await setup(page, { watched: false });
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('Shift+Alt+KeyW');
    await expect(page.locator('[data-feed-watch-picker]')).toHaveCount(0);
});

test('the context menu shows the key beside Watch this feed', async ({ page }) => {
    await setup(page, { watched: false });
    await row(page, 'Stub Blog').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /Watch this feed/ })).toContainText('Shift+Alt+W');
});

test('Shift+N opens the paper when a feed is watched, and not otherwise', async ({ page }) => {
    await setup(page, { watched: false });
    await page.keyboard.press('Shift+KeyN');
    await expect(modal(page)).toHaveCount(0);
    // It is not "add a category" any more either.
    await expect(page.locator('.bookmark-inline-create.category-add-create')).toHaveCount(0);
});

test('Shift+N opens the paper; j / k move through it; Enter opens; the legend shows the chips', async ({ page }) => {
    await setup(page);
    await page.keyboard.press('Shift+KeyN');
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.feed-news-entry')).toHaveCount(3);

    const keys = modal(page).locator('.feed-news-keys');
    await expect(keys).toHaveAttribute('aria-hidden', 'true');
    await expect(keys.locator('kbd').nth(0)).toHaveText('j / k');
    await expect(keys.locator('kbd').nth(1)).toHaveText('Esc');

    // Index: j / k move the highlighted row, Enter opens it.
    await page.keyboard.press('j');
    await expect(modal(page).locator('.feed-news-entry').nth(0)).toBeFocused();
    await page.keyboard.press('j');
    await expect(modal(page).locator('.feed-news-entry').nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(modal(page).locator('.feed-news-entry').nth(0)).toBeFocused();
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(modal(page).locator('.feed-news-title')).toHaveText(/Headline/);
    const first = await modal(page).locator('[data-feed-news-chip]').textContent();
    expect(first).toBe('2 of 3');

    // Article: j / k are next / previous.
    await page.keyboard.press('j');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('3 of 3');
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');
    await expect(modal(page).locator('.feed-news-keys kbd').first()).toHaveText('j / k');
});

test('j and k do nothing while typing in a field or with a modifier held', async ({ page }) => {
    await setup(page);
    await page.keyboard.press('Shift+KeyN');
    await expect(modal(page)).toBeVisible();
    await modal(page).locator('[data-feed-news-pick]').first().click();
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'fw-keys-probe';
        document.querySelector('[data-feed-news]').appendChild(input);
        input.focus();
    });
    await page.keyboard.press('j');
    await expect(page.locator('#fw-keys-probe')).toHaveValue('j');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');
    await page.locator('#fw-keys-probe').blur();
    await page.keyboard.press('Control+j');
    await expect(modal(page).locator('[data-feed-news-chip]')).toHaveText('1 of 3');
});
