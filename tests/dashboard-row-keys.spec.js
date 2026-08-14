const { test, expect } = require('@playwright/test');
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
