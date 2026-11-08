// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * Plain letters on a focused block title, the same letters its menu shows:
 * a category takes a (add bookmark), t (find tags), v (view), i (icon), w
 * (spread); a widget takes r (refresh), d (duplicate), s (settings), w (width).
 * Shift+W no longer sets a width; it is only the news.
 */

const catTitle = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"]):not([data-widget-id]) .category-title';

async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
}

/** Focus the first stored category's title and return its category id. */
async function focusCategoryTitle(page) {
    const title = page.locator(catTitle).first();
    await title.focus();
    await expect(title).toBeFocused();
    return title.evaluate((el) => el.closest('.category').getAttribute('data-category-id'));
}

test.describe('category title letters', () => {
    test.beforeEach(async ({ page }) => { await load(page); });

    test('a opens the new-bookmark form for that category', async ({ page }) => {
        const id = await focusCategoryTitle(page);
        await page.evaluate(() => {
            window.__form = null;
            window.dashboardInstance.openBookmarkFormModal = (o) => { window.__form = o; };
        });
        await page.keyboard.press('a');
        await expect.poll(() => page.evaluate(() => window.__form?.category), { timeout: 3000 }).toBe(String(id));
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('t starts the find-tags flow for that category', async ({ page }) => {
        await focusCategoryTitle(page);
        await page.evaluate(() => {
            window.__tagSearch = 0;
            window.dashboardInstance.config = window.dashboardInstance.config || {};
            window.dashboardInstance.config.runTagSearch = async () => { window.__tagSearch += 1; };
        });
        await page.keyboard.press('t');
        await expect.poll(() => page.evaluate(() => window.__tagSearch), { timeout: 3000 }).toBe(1);
        await expect(page.locator('#tag-popover')).toHaveCount(0);
    });

    test('v flips the category between rows and tiles', async ({ page }) => {
        const id = await focusCategoryTitle(page);
        const view = () => page.evaluate((cid) => (window.dashboardInstance.categories || [])
            .find((c) => String(c.id) === String(cid))?.view || 'rows', id);
        const before = await view();
        try {
            await page.keyboard.press('v');
            await expect.poll(view, { timeout: 5000 }).not.toBe(before);
        } finally {
            if ((await view()) !== before) {
                await page.locator(catTitle).first().focus();
                await page.keyboard.press('v');
                await expect.poll(view, { timeout: 5000 }).toBe(before);
            }
        }
    });

    test('i opens the icon picker', async ({ page }) => {
        await focusCategoryTitle(page);
        await page.evaluate(() => {
            window.__picker = 0;
            window.IconSetAuto = window.IconSetAuto || {};
            window.IconSetAuto.loadPicker = async () => ({ open: () => { window.__picker += 1; } });
        });
        await page.keyboard.press('i');
        await expect.poll(() => page.evaluate(() => window.__picker), { timeout: 3000 }).toBe(1);
    });

    test('w spreads the category, a second w puts it back', async ({ page }) => {
        const id = await focusCategoryTitle(page);
        const spread = () => page.evaluate((cid) => {
            const cat = (window.dashboardInstance.categories || []).find((c) => String(c.id) === String(cid));
            return window.DashboardCategorySpan.isCategorySpread(window.dashboardInstance, cat) === true;
        }, id);
        const before = await spread();
        const blocked = await page.evaluate((cid) => {
            const cat = (window.dashboardInstance.categories || []).find((c) => String(c.id) === String(cid));
            return window.DashboardCategorySpan.spreadBlockedReason?.(window.dashboardInstance, cat) ?? null;
        }, id).catch(() => null);
        test.skip(blocked, 'spreading is blocked on this dashboard');
        await page.keyboard.press('w');
        await expect.poll(spread, { timeout: 5000 }).toBe(!before);
        await page.locator(catTitle).first().focus();
        await page.keyboard.press('w');
        await expect.poll(spread, { timeout: 5000 }).toBe(before);
    });

    test('Shift+W on a title does not spread it', async ({ page }) => {
        const id = await focusCategoryTitle(page);
        const spread = () => page.evaluate((cid) => {
            const cat = (window.dashboardInstance.categories || []).find((c) => String(c.id) === String(cid));
            return window.DashboardCategorySpan.isCategorySpread(window.dashboardInstance, cat) === true;
        }, id);
        const before = await spread();
        await page.keyboard.press('Shift+W');
        // Guards a check that nothing happens: without the pause the check passes at once.
        await page.waitForTimeout(500);
        expect(await spread()).toBe(before);
    });

    test('reached with Shift+Home from a row, a title letter never runs on the row', async ({ page }) => {
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBeGreaterThanOrEqual(0);
        await page.keyboard.press('Shift+Home');
        await expect(page.locator('.category-title:focus')).toHaveCount(1);
        await page.keyboard.press('t');
        // Guards a check that nothing happens: without the pause the check passes at once.
        await page.waitForTimeout(400);
        // Whether this title offers t (a stored category) or not (a smart
        // collection), the row's tag popover stays shut.
        await expect(page.locator('#tag-popover')).toHaveCount(0);
    });
});

test.describe('widget title letters', () => {
    test.beforeEach(async ({ page }) => {
        await load(page);
        const has = await page.evaluate(() => !!document.querySelector('#dashboard-layout .dashboard-widget[data-widget-id] .category-title'));
        test.skip(!has, 'no widget on this dashboard');
        await page.locator('#dashboard-layout .dashboard-widget[data-widget-id] .category-title').first().focus();
    });

    test('d duplicates, s opens settings, w changes the width', async ({ page }) => {
        await page.evaluate(() => {
            window.__calls = [];
            const menu = window.dashboardInstance.categoryMenu;
            menu.runWidgetAction = async (action) => { window.__calls.push(action); };
        });
        for (const key of ['d', 's', 'w']) {
            await page.locator('#dashboard-layout .dashboard-widget[data-widget-id] .category-title').first().focus();
            await page.keyboard.press(key);
        }
        await expect.poll(() => page.evaluate(() => window.__calls.join(','))).toBe('duplicate,settings,width');
    });
});
