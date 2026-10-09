const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Actions that were reachable only with the mouse, in an app whose whole point
 * is the keyboard. Pin had no control at all — not even a right-click entry.
 */
async function focusFirstRow(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()), { timeout: 10_000 }).toBe(true);
}

test.describe('row actions from the keyboard', () => {
    test('Shift+P pins and unpins the selected row', async ({ page }) => {
        await focusFirstRow(page);
        const before = await page.evaluate(() =>
            !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark().pinned);

        await page.keyboard.press('Shift+P');
        await expect.poll(() => page.evaluate(() =>
            !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()?.pinned),
        { timeout: 5_000 }).toBe(!before);
    });

    test('Shift+S hands the row to the share path', async ({ page }) => {
        await focusFirstRow(page);
        const shared = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            let seen = null;
            const real = d.contextMenu.shareBookmark.bind(d.contextMenu);
            d.contextMenu.shareBookmark = async (bm) => { seen = bm?.url || ''; };
            d.keyboardNavigation.shareCurrent();
            d.contextMenu.shareBookmark = real;
            return seen;
        });
        expect(shared).toBeTruthy();
    });

    test('Shift+R reveals the row in Health, not just the view', async ({ page }) => {
        await focusFirstRow(page);
        const ref = await page.evaluate(() => {
            const d = window.dashboardInstance;
            let seen = null;
            const real = d.contextMenu.revealInHealth.bind(d.contextMenu);
            d.contextMenu.revealInHealth = async (r) => { seen = r; };
            d.keyboardNavigation.revealCurrentInHealth();
            d.contextMenu.revealInHealth = real;
            return seen;
        });
        // The row identity is what Shift+H and :health throw away.
        expect(ref).toBeTruthy();
        expect(ref.bookmark?.url).toBeTruthy();
    });

    /*
     * The real routes, on a fresh load: neither went through the loader's own
     * openLibraryView, so the views' stylesheet never came and the Bookmarks
     * view drew unstyled -- a bare list and a favicon the size of the screen.
     */
    const viewStyled = (page) => page.evaluate(() => ({
        sheet: !!document.querySelector('link[rel="stylesheet"][href*="/static/bundle/views.css"]')
            || !document.querySelector('[data-nextdash-view-css]'),
        library: !!document.querySelector('.config-view--library'),
        selected: !!document.querySelector('#config-bm-list .config-bm-row.keyboard-selected'),
    }));

    test('Shift+R lands on the row in a styled Bookmarks view', async ({ page }) => {
        await focusFirstRow(page);
        await page.keyboard.press('Shift+R');
        await expect.poll(() => viewStyled(page), { timeout: 10_000 })
            .toEqual({ sheet: true, library: true, selected: true });
    });

    test('the menu entry names the view and its key, and lands styled', async ({ page }) => {
        await focusFirstRow(page);
        await page.locator('.bookmark-link.keyboard-selected').click({ button: 'right' });
        const item = page.locator('#bookmark-context-menu [data-action="health"]');
        await expect(item).toContainText('Show in list');
        await expect(item).toContainText('Shift+R');
        // Every key chip whole: at the shared 16rem cap the widest row cut
        // "Shift+C" to "Shi…" and the label pushed this one off the edge.
        const cut = await page.evaluate(() => [...document.querySelectorAll('#bookmark-context-menu [data-action]')]
            .filter((row) => {
                const key = row.querySelector('.move-popover-item-key');
                const menu = row.closest('#bookmark-context-menu').getBoundingClientRect();
                return key && (key.scrollWidth > key.clientWidth + 1 || key.getBoundingClientRect().right > menu.right + 1);
            })
            .map((row) => row.dataset.action));
        expect(cut).toEqual([]);
        await item.click();
        await expect.poll(() => viewStyled(page), { timeout: 10_000 })
            .toEqual({ sheet: true, library: true, selected: true });
    });

    test('t filters to the tag on the row, and does nothing without one', async ({ page }) => {
        await focusFirstRow(page);
        const outcome = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const kn = d.keyboardNavigation;
            const row = document.querySelector('.bookmark-link.keyboard-selected') || document.querySelector('.bookmark-link');
            let filtered = '';
            d.toggleTagFilter = (tag) => { filtered = tag; };

            row.removeAttribute('data-bookmark-tags');
            const withoutTag = kn.filterByCurrentTag();

            row.setAttribute('data-bookmark-tags', 'probe-tag');
            const withTag = kn.filterByCurrentTag();
            return { withoutTag, withTag, filtered };
        });
        expect(outcome.withoutTag).toBe(false);   // the key must fall through
        expect(outcome.withTag).toBe(true);
        expect(outcome.filtered).toBe('probe-tag');
    });
});
