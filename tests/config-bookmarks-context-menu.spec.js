const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Right-click on a Config → Bookmarks row.
 *
 * The grid and the inbox have had one for a while; this list answered with the
 * browser's own menu. The entries all delegate to what the row, the ⋯ menu and
 * the bulk toolbar already do, so what is worth pinning here is the shape: that
 * it uses the same surface as the other menus, that the destructive entry sits
 * below a divider, and that a selection replaces the single-row entries rather
 * than sitting beside them.
 */

const MENU = '#config-bm-context-menu';
const ITEM = `${MENU} .move-popover-item`;

async function openBookmarksSection(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
}

const firstRow = (page) => page.locator('#config-bm-list .config-bm-row').first();

async function rightClickFirstRow(page) {
    await firstRow(page).locator('.config-bm-title').click({ button: 'right' });
    await expect(page.locator(MENU)).toBeVisible();
}

const actions = (page) => page.locator(ITEM).evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-action'))
);

test.describe('config bookmarks context menu', () => {
    test('right-click opens it on the same surface as the other menus', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const menu = page.locator(MENU);
        // The shared popover surface, not a second look for a second menu.
        await expect(menu).toHaveClass(/move-popover/);
        await expect(menu).toHaveAttribute('role', 'menu');
        // The name of the row it belongs to, the way the grid's menu opens.
        await expect(page.locator(`${MENU} .move-popover-current-hint`)).toBeVisible();
        expect((await actions(page)).length).toBeGreaterThan(6);
    });

    test('it carries the Config-only entries, not just the grid ones', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const list = await actions(page);
        // Shared with the grid.
        expect(list).toEqual(expect.arrayContaining(['open-new-tab', 'copy-url', 'edit', 'pin', 'delete']));
        // The part only this view can do: narrowing the list, and the
        // maintenance actions that otherwise live behind the ⋯ button.
        expect(list).toEqual(expect.arrayContaining(['filter-page', 'dashboard', 'health', 'title', 'favicon', 'archive']));
    });

    test('the destructive entry sits last, below a divider', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const list = await actions(page);
        expect(list[list.length - 1]).toBe('delete');
        await expect(page.locator(`${MENU} .move-popover-item.is-danger`)).toHaveCount(1);
        await expect(page.locator(`${MENU} .move-popover-divider`)).toHaveCount(1);

        // The divider marks the destructive zone: nothing harmless below it.
        const belowDivider = await page.locator(MENU).evaluate((menu) => {
            const kids = [...menu.children];
            const at = kids.findIndex((el) => el.classList.contains('move-popover-divider'));
            return kids.slice(at + 1).map((el) => el.getAttribute('data-action'));
        });
        expect(belowDivider).toEqual(['delete']);
    });

    // The shared .move-popover caps at 20rem and scrolls, which is right for the
    // move and tag popovers — they list every page or tag you have. This is a
    // fixed action list, and it is longer than the grid's, so the cap put the
    // last entries below a scrollbar that could not be reached.
    test('the whole menu is on screen, with nothing behind a scrollbar', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const box = await page.locator(MENU).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return {
                scrolls: el.scrollHeight > el.clientHeight + 1,
                top: r.top,
                bottom: r.bottom,
                left: r.left,
                right: r.right,
                vh: window.innerHeight,
                vw: window.innerWidth,
            };
        });
        expect(box.scrolls).toBe(false);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(box.vh);
        expect(box.right).toBeLessThanOrEqual(box.vw);

        // Every entry actually rendered, not just the ones above a fold.
        const allVisible = await page.locator(ITEM).evaluateAll((els) => els.every((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
        }));
        expect(allVisible).toBe(true);
    });

    /**
     * Geometry, driven from a chosen point rather than a right-click.
     *
     * Playwright scrolls a row into view before clicking it, so the cursor
     * always lands somewhere comfortable and the menu fits wherever it opens —
     * a first version of this test opened it that way and passed with the
     * clamping deleted, which is to say it tested nothing. The point is the only
     * input position() takes from the real path, so handing it an extreme one
     * exercises exactly what a right-click near an edge would.
     */
    for (const [name, at] of [
        ['bottom edge', { x: 400, y: 610 }],
        ['top edge', { x: 400, y: 4 }],
        ['right edge', { x: 1396, y: 300 }],
    ]) {
        test(`it stays on screen when opened at the ${name}`, async ({ page }) => {
            await page.setViewportSize({ width: 1400, height: 620 });
            await openBookmarksSection(page);

            await page.evaluate((point) => {
                const c = window.dashboardInstance.config;
                const key = document.querySelector('#config-bm-list .config-bm-row')
                    .getAttribute('data-bm-key');
                c.bookmarkContextMenu().show(key, c.findBookmarkByKey(key), point);
            }, at);
            await expect(page.locator(MENU)).toBeVisible();

            const box = await page.locator(MENU).evaluate((el) => {
                const r = el.getBoundingClientRect();
                return {
                    top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                    height: r.height, vh: window.innerHeight, vw: window.innerWidth,
                };
            });
            // The premise: too tall to sit on either side of a mid-window click,
            // so only clamping can keep it in view.
            expect(box.height).toBeGreaterThan(box.vh / 2);
            expect(Math.round(box.top)).toBeGreaterThanOrEqual(0);
            expect(Math.round(box.left)).toBeGreaterThanOrEqual(0);
            expect(Math.round(box.bottom)).toBeLessThanOrEqual(box.vh);
            expect(Math.round(box.right)).toBeLessThanOrEqual(box.vw);
        });
    }

    // The entry used to call the row's own ⋯ check menu, which is anchored to
    // the badge on the far side of the row — so choosing it made the menu vanish
    // and a second one appear somewhere else entirely.
    test('Checking opens where the menu was, not somewhere else', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const before = await page.locator(MENU).evaluate((el) => ({
            x: parseFloat(el.style.left), y: parseFloat(el.style.top),
        }));

        await page.locator(`${MENU} [data-action="check-mode"]`).click();
        const sub = page.locator('#config-bm-check-mode-menu');
        await expect(sub).toBeVisible();
        // The row's own badge menu must stay shut: two menus for one choice.
        await expect(page.locator('.health-view-menu:not([hidden])')).toHaveCount(0);

        // Read the settled corner: both popovers animate in with translateY(-6px),
        // so a rect taken mid-animation is a few pixels off through no fault of
        // the placement. style.left/top is what was actually set.
        const after = await sub.evaluate((el) => ({
            x: parseFloat(el.style.left), y: parseFloat(el.style.top),
        }));
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

        // The three modes, on the same surface.
        await expect(sub).toHaveClass(/move-popover/);
        await expect(sub.locator('[data-check-mode]')).toHaveCount(3);
        // Escape walks back to the parent rather than closing outright.
        await page.keyboard.press('Escape');
        await expect(sub).toHaveCount(0);
        await expect(page.locator(MENU)).toBeVisible();
    });

    // config.t() takes only (key, fallback); a third argument is dropped, so
    // every templated label rendered its placeholder verbatim.
    test('templated labels interpolate rather than showing the placeholder', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const checking = await page.locator(`${MENU} [data-action="check-mode"]`).textContent();
        expect(checking).not.toContain('{mode}');
        expect(checking).toMatch(/Checking \(.+\)/);

        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.visibleBookmarks().slice(0, 2).forEach((b) => c.bmSelected.add(c.bookmarkKey(b)));
            c.repaintBookmarksList();
        });
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 10_000 });
        await rightClickFirstRow(page);

        const bulk = await page.locator(`${MENU} [data-action="bulk-delete"]`).textContent();
        expect(bulk).not.toContain('{count}');
        expect(bulk).toContain('2');
    });

    test('Escape closes it and hands focus back to the row', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        await page.keyboard.press('Escape');
        await expect(page.locator(MENU)).toHaveCount(0);
        // Not <body>: losing the row would drop the list's j/k navigation.
        const onRow = await page.evaluate(() =>
            !!document.activeElement?.classList?.contains('config-bm-row'));
        expect(onRow).toBe(true);
    });

    test('the arrow keys walk it', async ({ page }) => {
        await openBookmarksSection(page);
        await rightClickFirstRow(page);

        const focused = () => page.locator(`${MENU} .move-popover-item.is-focused`);
        await expect(focused()).toHaveCount(1);
        const first = await focused().getAttribute('data-action');
        await page.keyboard.press('ArrowDown');
        await expect(focused()).toHaveCount(1);
        expect(await focused().getAttribute('data-action')).not.toBe(first);
        // Wraps to the last entry rather than stopping at the top.
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        expect(await focused().getAttribute('data-action')).toBe('delete');
    });

    test('Shift+right-click falls through to the browser menu', async ({ page }) => {
        await openBookmarksSection(page);
        await firstRow(page).locator('.config-bm-title')
            .click({ button: 'right', modifiers: ['Shift'] });
        await page.waitForTimeout(300);
        await expect(page.locator(MENU)).toHaveCount(0);
    });

    test('a selection replaces the single-row entries', async ({ page }) => {
        await openBookmarksSection(page);
        // Two ticked rows, the state where acting on the row under the cursor
        // would silently ignore what the user had already selected.
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.visibleBookmarks().slice(0, 2).forEach((b) => c.bmSelected.add(c.bookmarkKey(b)));
            c.repaintBookmarksList();
        });
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 10_000 });
        await rightClickFirstRow(page);

        const list = await actions(page);
        expect(list).toEqual(expect.arrayContaining(['bulk-move', 'bulk-tags', 'bulk-delete', 'clear']));
        // Not both: "Delete" and "Delete 2 selected" side by side would point at
        // different sets.
        expect(list).not.toContain('delete');
        expect(list).not.toContain('edit');
    });

    test('filtering to the row\'s page narrows the list', async ({ page }) => {
        await openBookmarksSection(page);
        const before = await page.locator('#config-bm-list .config-bm-row').count();
        await rightClickFirstRow(page);

        await page.locator(`${MENU} [data-action="filter-page"]`).click();
        await expect(page.locator(MENU)).toHaveCount(0);
        await page.waitForTimeout(400);

        const filter = await page.evaluate(() => String(window.dashboardInstance.config.bmPageFilter || ''));
        expect(filter).not.toBe('');
        const after = await page.locator('#config-bm-list .config-bm-row').count();
        expect(after).toBeGreaterThan(0);
        expect(after).toBeLessThanOrEqual(before);
    });
});
