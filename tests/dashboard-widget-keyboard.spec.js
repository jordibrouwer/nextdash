// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The keyboard goes into a widget, not around it.
 *
 * The grid's cursor collected `.bookmark-link` and the show-more toggles and
 * nothing else, so a widget was a wall: arrowing down the column walked past
 * the block, and no key reached the rows a mouse could click. Widgets build
 * their actionable rows as <button> already — the work is letting the cursor
 * see them, and keeping the bookmark keys off them.
 */

async function dashboardWithAWidget(page, { widgets } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async ([list]) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        for (let n = 0; n < 4; n += 1) {
            await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
                name: `Row ${n}`, url: `https://row.example/${n}`, category: 'one' } }) });
        }
        await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({ widgets: list }) });
    }, [widgets || [{ type: 'health', title: 'Status' }]]);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.dashboard-widget').first()).toBeVisible({ timeout: 15_000 });
}

/** What the grid cursor is sitting on, described in a way a test can read. */
const cursor = (page) => page.evaluate(() => {
    const kn = window.dashboardInstance.keyboardNavigation;
    const el = kn.navigableElements[kn.currentIndex] || null;
    if (!el) return null;
    return {
        widget: Boolean(el.closest('.dashboard-widget')),
        bookmark: el.classList.contains('bookmark-link'),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        focused: document.activeElement === el,
        selected: el.classList.contains('keyboard-selected'),
    };
});

/** Walk the cursor with real key presses until it lands inside a widget. */
async function arrowIntoWidget(page, limit = 40) {
    for (let n = 0; n < limit; n += 1) {
        await page.keyboard.press('ArrowDown');
        const at = await cursor(page);
        if (at?.widget) return at;
    }
    return null;
}

test.describe('arrowing through a widget', () => {
    test('the cursor stops on a widget figure and the figure has focus', async ({ page }) => {
        await dashboardWithAWidget(page);

        const at = await arrowIntoWidget(page);
        expect(at, 'the cursor never reached the widget').not.toBe(null);
        expect(at.focused).toBe(true);
        expect(at.selected).toBe(true);
    });

    test('Enter on a widget figure does what clicking it does', async ({ page }) => {
        await dashboardWithAWidget(page);
        await arrowIntoWidget(page);

        await page.keyboard.press('Enter');
        // The health tile's figures are filters into the health view.
        await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 })
            .toContain('health');
    });

    test('a readout that does nothing is not a stop', async ({ page }) => {
        await dashboardWithAWidget(page);

        const stops = await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.updateNavigableElements();
            return kn.navigableElements
                .filter((el) => el.closest('.dashboard-widget'))
                .map((el) => el.tagName);
        });
        expect(stops.length).toBeGreaterThan(0);
        expect(stops.every((tag) => tag === 'BUTTON')).toBe(true);
    });

    test('a folded widget offers nothing to walk into', async ({ page }) => {
        await dashboardWithAWidget(page);

        await page.locator('.dashboard-widget .category-title').click();
        await expect(page.locator('.dashboard-widget')).toHaveAttribute('data-collapsed', 'true');

        const inside = await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.updateNavigableElements();
            return kn.navigableElements.filter((el) => el.closest('.dashboard-widget')).length;
        });
        expect(inside).toBe(0);
    });
});

test.describe('the bookmark keys stay off a widget', () => {
    test('e and Delete do nothing with the cursor in a widget', async ({ page }) => {
        await dashboardWithAWidget(page);
        const at = await arrowIntoWidget(page);
        expect(at).not.toBe(null);

        const before = await page.evaluate(() =>
            (window.dashboardInstance.bookmarks || []).length);

        await page.keyboard.press('Shift+E');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(600);

        // Nothing opened, nothing was removed, and the cursor did not wander.
        expect(await page.locator('.bookmark-inline-editing').count()).toBe(0);
        expect(await page.evaluate(() => (window.dashboardInstance.bookmarks || []).length)).toBe(before);
        expect((await cursor(page))?.widget).toBe(true);
    });

    test('x does not tick a widget figure into the bookmark selection', async ({ page }) => {
        await dashboardWithAWidget(page);
        const at = await arrowIntoWidget(page);
        expect(at).not.toBe(null);

        await page.keyboard.press('x');
        await page.waitForTimeout(400);

        // This is the dangerous one. x hands the selected element straight to
        // multiSelect, which then holds a widget button as though it were a
        // bookmark — and Delete acts on that selection.
        const picked = await page.evaluate(() => ({
            active: Boolean(window.dashboardInstance.multiSelect?.isActive?.()),
            count: window.dashboardInstance.multiSelect?.selected?.size ?? 0,
        }));
        expect(picked.active).toBe(false);
        expect(picked.count).toBe(0);
    });
});

/*
Out of the widget and onto its header.

Shift+Home steps from a row to the header above it, where the block's own keys
live — rename, width, the menu. It resolves the block by data-category-id, which
a widget carries, so it should land on a widget header exactly as it lands on a
category one.
*/
test('Shift+Home from inside a widget lands on the widget header', async ({ page }) => {
    await dashboardWithAWidget(page);
    const at = await arrowIntoWidget(page);
    expect(at).not.toBe(null);

    await page.keyboard.press('Shift+Home');

    const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return {
            isHeader: Boolean(el?.classList?.contains('category-title')),
            inWidget: Boolean(el?.closest('.dashboard-widget')),
        };
    });
    expect(focused).toEqual({ isHeader: true, inWidget: true });
});

/*
The row says what it does, and the menu repeats it.

A click handler is a closure: it works for the pointer and tells nothing else
what the row is for. Right-click on a row — and Shift+F10 with the cursor on it,
which arrives as the same event — leads the menu with that row's own action,
followed by the widget's, because the block under the row is still what is being
pointed at.
*/
test.describe('the menu on a widget row', () => {
    test('leads with what the row does, then the widget actions', async ({ page }) => {
        await dashboardWithAWidget(page);

        const row = page.locator('.dashboard-widget button[data-widget-action]').first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        await row.click({ button: 'right' });

        const menu = page.locator('#widget-context-menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const actions = await menu.evaluate((m) =>
            [...m.querySelectorAll('[data-action]')].map((el) => el.getAttribute('data-action')));
        expect(actions[0]).toBe('row-open');
        expect(actions).toContain('rename');
        expect(actions).toContain('width');
        expect(actions).toContain('close');
        // Named after the row's own action rather than a second description
        // written in the menu.
        await expect(menu.locator('[data-action="row-open"]')).toContainText('Health');
    });

    test('picking that entry does what clicking the row does', async ({ page }) => {
        await dashboardWithAWidget(page);

        const row = page.locator('.dashboard-widget button[data-widget-action]').first();
        await row.click({ button: 'right' });
        await page.locator('#widget-context-menu [data-action="row-open"]').click();

        await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 })
            .toContain('health');
    });

    test('the header menu carries no row entry', async ({ page }) => {
        await dashboardWithAWidget(page);

        await page.locator('.dashboard-widget .category-title').click({ button: 'right' });
        const menu = page.locator('#widget-context-menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        await expect(menu.locator('[data-action="row-open"]')).toHaveCount(0);
    });

    test('a row standing for an address offers the address, and Ctrl+Enter opens it', async ({ page }) => {
        // The uptime tile's rows are monitored bookmarks, so they carry one.
        await dashboardWithAWidget(page, { widgets: [{ type: 'uptime', title: 'Uptime' }] });
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = {
                'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
            };
            await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
                // An address this test can actually reach, so the new tab lands
                // somewhere rather than failing to resolve.
                name: 'Watched', url: `${location.origin}/?watched=1`, checkStatus: true, monitor: true } }) });
            await f('/api/bookmark-health?view=facts&refresh=1');
        });
        await page.reload({ waitUntil: 'networkidle' });

        const row = page.locator('.dashboard-widget button[data-widget-href]').first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        await row.click({ button: 'right' });
        await expect(page.locator('#widget-context-menu [data-action="row-open-tab"]')).toBeVisible({ timeout: 10_000 });
        await page.keyboard.press('Escape');

        // From the keyboard: plain Enter is the tile's own action, Ctrl+Enter is
        // the address — the same split a bookmark row has. Focus is put on the
        // row the way Tab would, which the cursor has to follow.
        await row.focus();
        await expect.poll(() => cursor(page).then((at) => at?.widget), { timeout: 10_000 }).toBe(true);
        const opened = page.waitForEvent('popup', { timeout: 10_000 });
        await page.keyboard.press('Control+Enter');
        const tab = await opened;
        await tab.waitForLoadState('domcontentloaded').catch(() => {});
        expect(tab.url()).toContain('watched=1');
    });
});
