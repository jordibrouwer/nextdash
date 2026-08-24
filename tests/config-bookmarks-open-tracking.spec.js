// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Opening a bookmark from Config → Bookmarks records the open, and the usage
 * line under the row says so straight away.
 *
 * The bug: this list called window.open and nothing else, so the row kept the
 * "Jul 6 2×" it was rendered with for a link you had just used — while Health
 * and Inbox both recorded their opens.
 */
async function openBookmarksPanel(page) {
    // window.open is stubbed before load: a real popup is blocked in the
    // harness and the Open click would hang waiting for a tab never appears.
    await page.addInitScript(() => {
        window.__opened = [];
        window.open = (url) => { window.__opened.push(url); return null; };
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !window.dashboardInstance._deferredAllBookmarksLoadInFlight);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();
    // The actions bar expands from 0fr on hover; without this the button slides
    // out from under the cursor and the click lands on the row behind it.
    await page.evaluate(() => document.body.classList.add('no-animations'));
}

/**
 * Hover the first row so its actions bar is out, and hand back the Open button.
 *
 * The hover is also where a background reload tends to land: it replaces the
 * whole allBookmarks array, so anything seeded into those objects beforehand is
 * discarded. Hovering first, then seeding, keeps the two apart.
 */
async function armFirstRow(page) {
    await expect
        .poll(() => page.locator('#config-bm-list .config-bm-row').count())
        .toBeGreaterThan(0);
    const row = page.locator('#config-bm-list .config-bm-row').first();
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    // Let the reload the hover kicked off settle before anything is seeded.
    await page.waitForFunction(() => {
        const now = window.dashboardInstance.allBookmarks;
        const settled = window.__bmArr === now;
        window.__bmArr = now;
        return settled;
    }, null, { timeout: 15_000 });
    return { row, openBtn: row.locator('[data-feed-action="open"]') };
}

/** Give the first row an old open, so a fresh one is visibly different. */
async function seedStaleOpen(page) {
    return page.evaluate(() => {
        const cfg = window.dashboardInstance.config;
        const key = document.querySelector('#config-bm-list .config-bm-row')?.getAttribute('data-bm-key');
        const bm = key ? cfg.findBookmarkByKey(key) : null;
        if (!bm) throw new Error('no visible bookmark');
        bm.lastOpened = Date.now() - 30 * 86400e3;
        bm.openCount = 2;
        cfg.repaintBookmarksList();
        return key;
    });
}

function usageText(page) {
    return page.locator('#config-bm-list .config-bm-row').first()
        .locator('.config-bm-usage-col').innerText();
}

test.describe('config bookmarks — opening a row', () => {
    test('opening a row updates the last-opened line without a reload', async ({ page }) => {
        await openBookmarksPanel(page);
        const { openBtn } = await armFirstRow(page);
        await seedStaleOpen(page);
        await page.route('**/api/track-open', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }));

        expect(await usageText(page)).toContain('2×');

        await openBtn.click();

        await expect.poll(() => page.evaluate(() => window.__opened.length)).toBeGreaterThan(0);
        // The label and the count both move, in the row already on screen.
        await expect.poll(() => usageText(page)).toContain('just opened');
        expect(await usageText(page)).toContain('3×');
    });

    test('opening a row records the open server-side', async ({ page }) => {
        await openBookmarksPanel(page);
        const { openBtn } = await armFirstRow(page);

        let posted = null;
        await page.route('**/api/track-open', async (route) => {
            posted = route.request().postData();
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
        });

        await openBtn.click();

        await expect.poll(() => posted).not.toBeNull();
        const body = JSON.parse(posted);
        expect(body).toHaveProperty('pageId');
        expect(body).toHaveProperty('index');
        expect(Number(body.index)).toBeGreaterThanOrEqual(0);
    });

    // Re-filtering on click would let the row vanish from the list you are
    // working through the moment you opened it — the same reason Health holds
    // still. Under the never-opened filter that is exactly what a re-render
    // would do, so this catches the eager repaint the narrow one replaced.
    test('opening a row does not drop it out of the filtered list', async ({ page }) => {
        await openBookmarksPanel(page);
        const { openBtn } = await armFirstRow(page);
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const key = document.querySelector('#config-bm-list .config-bm-row').getAttribute('data-bm-key');
            const bm = cfg.findBookmarkByKey(key);
            bm.lastOpened = 0;
            bm.openCount = 0;
            cfg.bmCleanupFilter = 'never';
            cfg.invalidateVisibleBookmarks();
            cfg.repaintBookmarksList();
        });
        await page.route('**/api/track-open', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }));

        const order = () => page.evaluate(() =>
            [...document.querySelectorAll('#config-bm-list .config-bm-title')].map((el) => el.textContent.trim()));
        const before = await order();
        expect(before.length).toBeGreaterThan(0);

        await openBtn.click();
        await page.waitForTimeout(700);

        // Still there, and now showing the open that just happened.
        expect(await order()).toEqual(before);
        expect(await usageText(page)).toContain('just opened');
    });
});
