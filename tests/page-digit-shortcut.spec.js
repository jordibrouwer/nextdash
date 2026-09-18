// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A digit switches pages, and that is all it does.
 *
 * Two listeners answer the same keystroke, both in the bubble phase on
 * document: the dashboard switches the page, and the search palette treats a
 * digit as one of the keys that may launch it. stopPropagation does not
 * separate them — siblings on the same element need stopImmediatePropagation —
 * so pressing 1 moved the page *and* threw the search modal over it.
 *
 * The palette already stands aside for the g-chord that also uses digits. It
 * should stand aside for the same reason here: the digit is spoken for. A digit
 * that names no page is still the palette's, which is what makes this a guard
 * rather than a removal.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** A second page to switch to, since a fresh install has one. */
async function ensureTwoPages(page) {
    const count = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        if (d.pages.length >= 2) return d.pages.length;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const next = [...d.pages, { id: Math.max(...d.pages.map((p) => Number(p.id) || 0)) + 1, name: 'Second' }];
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
        });
        return next.length;
    });
    expect(count, 'the test needs a second page to switch to').toBeGreaterThanOrEqual(2);
}

test('a digit switches page without opening the search palette', async ({ page }) => {
    await openDashboard(page);
    await ensureTwoPages(page);
    await openDashboard(page);

    const before = await page.evaluate(() => String(window.dashboardInstance.currentPageId));

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('2');
    await page.waitForTimeout(600);

    const opened = await page.evaluate(() => ({
        active: !!window.dashboardInstance?.searchComponent?.searchActive,
        shown: !!document.getElementById('shortcut-search')?.classList.contains('show'),
    }));
    expect(opened, 'the search palette opened on top of the page switch').toEqual({ active: false, shown: false });

    const after = await page.evaluate(() => String(window.dashboardInstance.currentPageId));
    expect(after, 'the digit did not switch the page either').not.toBe(before);
});

/**
 * The boundary the guard draws, asserted directly.
 *
 * Whether a digit beyond the last page reaches the palette cannot be measured
 * here — a fresh install does not open it on digits at all, whatever the
 * ordering of the two listeners happens to be on that build. What can be
 * pinned is the claim the guard makes: a digit is only taken away from the
 * palette when it really names a page, and only on the view that has pages.
 */
test('the guard claims a digit only when it names a page', async ({ page }) => {
    await openDashboard(page);
    await ensureTwoPages(page);
    await openDashboard(page);

    const verdicts = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        const count = window.dashboardInstance.pages.length;
        return {
            count,
            first: s._digitNamesAPage('1'),
            last: s._digitNamesAPage(String(count)),
            beyond: s._digitNamesAPage(String(count + 1)),
            far: s._digitNamesAPage('9'),
        };
    });

    expect(verdicts.count).toBeGreaterThanOrEqual(2);
    expect(verdicts.first, 'page one is a page').toBe(true);
    expect(verdicts.last, 'the last page is a page').toBe(true);
    expect(verdicts.beyond, 'one past the end names nothing, so the palette keeps it').toBe(false);
    expect(verdicts.far, 'a digit far beyond the pages belongs to the palette').toBe(false);
});

/*
 * Every digit belongs to the pages, whether or not it has one.
 *
 * Left to fall through, 5 on a two-page install opened the shortcut palette
 * while 2 switched pages — the same key doing two unrelated things depending on
 * how many pages you happen to have, and changing meaning the moment you add
 * one. 1-9 switch or do nothing; 0 opens the inbox or does nothing. Digits are
 * still typed *into* a query once it is open, which is the second test here.
 */
test('a digit with no page behind it does nothing at all', async ({ page }) => {
    await openDashboard(page);
    await ensureTwoPages(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        // 0 is the inbox's legacy key while the inbox is on; switch it off so
        // this is about the digits with nothing behind them.
        d.settings.inboxEnabled = false;
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    for (const key of ['5', '8', '0']) {
        // Reset through the component, not the Escape key: on a bare grid with
        // nothing selected, Escape has its own job (it goes home, then opens
        // search) — pressing it here would open the very panel this test is
        // checking the digit does not.
        await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
        await page.waitForTimeout(250);
        await page.keyboard.press(key);
        await page.waitForTimeout(600);

        const seen = await page.evaluate(() => ({
            open: document.getElementById('shortcut-search')?.classList.contains('show') === true,
            query: window.dashboardInstance?.searchComponent?.currentQuery ?? '',
        }));
        expect(seen.open, `${key} opened the palette`).toBe(false);
        expect(seen.query, `${key} reached the query`).toBe('');
    }
});

test('a digit still types into a query that is already open', async ({ page }) => {
    await openDashboard(page);

    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(
        () => document.getElementById('shortcut-search')?.classList.contains('show') === true,
    )).toBe(true);

    await page.keyboard.press('5');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance?.searchComponent?.currentQuery,
    )).toBe('5');
});

test('0 still opens the inbox while the inbox is on', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.inboxEnabled = true;
        d.settings.inboxShowInPageTabs = true;
        await d.saveSettings?.();
        d.pageNav?.renderPageNavigation?.();
    });
    await page.waitForTimeout(400);

    await page.keyboard.press('0');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    expect(await page.evaluate(
        () => document.getElementById('shortcut-search')?.classList.contains('show') === true,
    ), 'the palette opened over the inbox').toBe(false);
});
