// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Four small gaps around the category header and the grid's status line.
 *
 * The category menu offers Rename and Delete without ever mentioning that F2 and
 * Delete do the same from the keyboard. The sort menu button claims
 * aria-haspopup="menu", which promises ArrowDown opens it, and only a click did.
 * An incremental render built a different, actionless empty state for a category
 * than a full render did — at the exact moment the offer is most useful, having
 * just deleted the last row. And #dashboard-mini-status is aria-live but was
 * only ever refreshed on a page change, so narrowing the grid with a tag filter
 * said nothing.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function openCategoryMenu(page) {
    await page.evaluate(() => {
        // Not simply the first: smart collections render a header too and
        // bindCategory deliberately skips them, so there is no menu to open.
        const title = document.querySelector(
            '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"]) .category-title');
        title.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, clientX: 300, clientY: 300,
        }));
    });
    await expect(page.locator('#category-context-menu')).toBeVisible({ timeout: 5000 });
}

test.describe('the category menu', () => {
    test('shows the keyboard route beside the actions that have one', async ({ page }) => {
        await openDashboard(page);
        await openCategoryMenu(page);

        const hints = await page.evaluate(() => {
            const byAction = {};
            document.querySelectorAll('#category-context-menu [role="menuitem"]').forEach((item) => {
                byAction[item.getAttribute('data-action')] =
                    item.querySelector('.move-popover-item-key')?.textContent || null;
            });
            return byAction;
        });

        expect(hints.rename).toBe('F2');
        expect(hints.delete).toBe('Delete');
        // "Add category" carries its key too now that c acts on the first
        // press. While it needed a hold, a chip reading "c" would have promised
        // a tap that went to the shortcut search instead.
        expect(hints.add).toBe('c');
    });

    test('the chips are decoration, not a second thing to read out', async ({ page }) => {
        await openDashboard(page);
        await openCategoryMenu(page);

        const chips = await page.evaluate(() =>
            [...document.querySelectorAll('#category-context-menu .move-popover-item-key')]
                .map((el) => el.getAttribute('aria-hidden')));
        // Asserted before the `every` below, which is trivially true on an
        // empty list — the shape this test had first, and it passed with the
        // chips removed entirely.
        expect(chips.length).toBeGreaterThan(0);
        expect(chips.every((v) => v === 'true')).toBe(true);
    });
});

test.describe('the category sort menu button', () => {
    test('ArrowDown opens it, as aria-haspopup promises', async ({ page }) => {
        await openDashboard(page);

        const btn = page.locator('.category-sort-menu-btn').first();
        test.skip(await btn.count() === 0, 'sort controls are switched off');
        await expect(btn).toHaveAttribute('aria-haspopup', 'menu');

        await btn.focus();
        await page.keyboard.press('ArrowDown');

        await expect(page.locator('.category-sort-menu').first()).toBeVisible({ timeout: 5000 });
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
    });

    test('a click still works, and ArrowDown does not toggle it shut again', async ({ page }) => {
        await openDashboard(page);
        const btn = page.locator('.category-sort-menu-btn').first();
        test.skip(await btn.count() === 0, 'sort controls are switched off');

        await btn.click();
        await expect(page.locator('.category-sort-menu').first()).toBeVisible({ timeout: 5000 });

        // The open menu owns the arrow keys from here — this must not close it.
        await btn.focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.category-sort-menu').first()).toBeVisible();
    });
});

test.describe('an emptied category', () => {
    test('offers the same "+ bookmark" after an incremental render as after a full one', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const categoryEl = document.querySelector(
                '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])');
            if (!categoryEl) return { skipped: true };
            const id = categoryEl.getAttribute('data-category-id');
            const category = (d.categories || []).find((c) => String(c.id) === String(id));
            if (!category) return { skipped: true };

            // Patched directly rather than by emptying the category and
            // re-rendering: with "hide empty categories" on, the block would
            // vanish from the desired layout, the structure check would refuse
            // the patch, and the full render would answer instead — which is the
            // path that already had the button.
            d.renderIncremental.patchCategoryBookmarks(categoryEl, category, []);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const el = categoryEl.querySelector('.empty-state--category');
            return {
                hasEmptyState: Boolean(el),
                hasButton: Boolean(el?.querySelector('.empty-state--category-btn')),
            };
        });

        test.skip(result.skipped === true, 'no ordinary category in the fixture');
        expect(result.hasEmptyState).toBe(true);
        expect(result.hasButton).toBe(true);
    });
});

test.describe('the live status line', () => {
    test('counts the rows on the grid', async ({ page }) => {
        await openDashboard(page);

        const state = await page.evaluate(() => {
            const el = document.getElementById('dashboard-mini-status');
            return {
                live: el.getAttribute('aria-live'),
                text: el.textContent,
                rows: document.querySelectorAll(
                    '#dashboard-layout .bookmark-link[data-bookmark-url]:not(.is-overflow-hidden)').length,
            };
        });

        expect(state.live).toBe('polite');
        expect(state.text).toContain(String(state.rows));
    });

    test('the count follows the grid when a tag filter narrows it', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const el = document.getElementById('dashboard-mini-status');
            const before = el.textContent;

            const tag = (d.bookmarks || []).flatMap((b) => b.tags || [])[0];
            if (!tag) return { skipped: true };
            d._tagFilters = [tag];
            d.renderDashboard();
            await new Promise((resolve) => setTimeout(resolve, 300));

            return { before, after: el.textContent };
        });

        test.skip(result.skipped === true, 'fixture has no tagged bookmarks');
        expect(result.after).not.toBe(result.before);
    });

    // A guard against noise this change could introduce rather than against the
    // original gap: the line is aria-live, so refreshing it on every render
    // would re-announce the date and page name each time the grid repainted.
    test('an unchanged grid does not rewrite it, so it is not re-announced', async ({ page }) => {
        await openDashboard(page);

        const rewritten = await page.evaluate(async () => {
            const el = document.getElementById('dashboard-mini-status');
            let writes = 0;
            const observer = new MutationObserver(() => { writes += 1; });
            observer.observe(el, { childList: true, characterData: true, subtree: true });

            window.dashboardInstance.renderDashboard({ incremental: false });
            await new Promise((resolve) => setTimeout(resolve, 300));
            observer.disconnect();
            return writes;
        });

        expect(rewritten).toBe(0);
    });
});
