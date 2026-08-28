// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Coming back to the window leaves you where you were.
 *
 * The revision poll runs on every focus and visibilitychange, and a monitored
 * check writing one sample is enough to change the revision — so switching to
 * another window and back reloaded the page. That reload came through the same
 * path a page switch does, which starts at the top: right for a page you are
 * arriving on, wrong for the one you are already reading. The reader was thrown
 * to the top of their own dashboard for a refresh they never asked for.
 */

async function longDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        for (let n = 0; n < 60; n += 1) {
            await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
                name: `Filler ${n}`, url: `https://filler.example/${n}`, category: `cat${n % 4}` } }) });
        }
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
}

test.describe('a refresh of the page you are on', () => {
    test('leaves the scroll where the reader put it', async ({ page }) => {
        await longDashboard(page);

        await page.evaluate(() => window.scrollTo(0, 700));
        await page.waitForTimeout(300);
        const before = await page.evaluate(() => Math.round(window.scrollY));
        expect(before).toBeGreaterThan(300);

        // What coming back to the window does: the poll finds a new revision
        // and reloads the page under the reader.
        await page.evaluate(() => window.dashboardInstance.data.loadPageBookmarks(
            window.dashboardInstance.currentPageId, { forceFetch: true, animate: false, quiet: true }));
        await page.waitForTimeout(800);

        expect(Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - before)).toBeLessThan(30);
    });

    test('switching pages still arrives at the top', async ({ page }) => {
        await longDashboard(page);
        // A second page to arrive on, since arriving is the case under test.
        const pages = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = {
                'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
            };
            const current = window.dashboardInstance.pages || [];
            if (current.length < 2) {
                const nextId = Math.max(0, ...current.map((p) => Number(p.id))) + 1;
                await f('/api/pages', {
                    method: 'POST', headers: h,
                    body: JSON.stringify([...current, { id: nextId, name: 'Second' }]),
                });
                window.dashboardInstance.pages = [...current, { id: nextId, name: 'Second' }];
            }
            return (window.dashboardInstance.pages || []).map((p) => p.id);
        });
        expect(pages.length).toBeGreaterThan(1);

        await page.evaluate(() => window.scrollTo(0, 700));
        await page.waitForTimeout(300);

        await page.evaluate(async ([id]) => {
            await window.dashboardInstance.data.loadPageBookmarks(id, { forceFetch: true, animate: false });
        }, [pages[1]]);
        await page.waitForTimeout(800);

        // A page you are arriving on has its own place, and with none remembered
        // that place is the top.
        expect(await page.evaluate(() => Math.round(window.scrollY))).toBeLessThan(30);
    });
});
