// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two bookmarks sharing a URL on one page.
 *
 * Rows normally resolve by object identity, but a detached copy — what the
 * smart collections hand back — falls through to a URL lookup. That lookup used
 * to return the first match, so acting on the second copy hit the first one.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.bookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('a detached copy resolves to its own row, not the first match', async ({ page }) => {
    await loadDashboard(page);

    const result = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const cat = d.bookmarks[0]?.category || '';
        d.bookmarks = [
            ...d.bookmarks,
            { name: 'Dup A', url: 'https://dup.example.com/', category: cat, tags: [] },
            { name: 'Dup B', url: 'https://dup.example.com/', category: cat, tags: [] },
        ];
        d.renderDashboard({ animate: false });

        const rows = d.bookmarkRows || d;
        const resolve = (bm) => rows.resolveBookmarkIndex(bm);
        const lastIndex = d.bookmarks.length - 1;
        const b = d.bookmarks[lastIndex];

        return {
            byIdentity: resolve(b),
            byDetachedCopy: resolve({ ...b }),
            expected: lastIndex,
        };
    });

    expect(result.byIdentity).toBe(result.expected);
    expect(result.byDetachedCopy).toBe(result.expected);
});

test('the keyboard picks the selected row when URLs repeat', async ({ page }) => {
    await loadDashboard(page);

    const result = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const cat = d.bookmarks[0]?.category || '';
        d.bookmarks = [
            ...d.bookmarks,
            { name: 'Keyboard A', url: 'https://kb.example.com/', category: cat, tags: [] },
            { name: 'Keyboard B', url: 'https://kb.example.com/', category: cat, tags: [] },
        ];
        d.renderDashboard({ animate: false });

        const nav = d.keyboardNavigation;
        if (!nav) return { skipped: true };
        nav.updateNavigableElements();

        // Land on the row whose label reads "Keyboard B".
        const idx = nav.navigableElements.findIndex((el) =>
            (el.querySelector('.bookmark-text')?.textContent || '').trim() === 'Keyboard B');
        if (idx < 0) return { skipped: true };
        nav.currentIndex = idx;

        // Strip the index hint so the URL fallback is what answers.
        nav.navigableElements[idx].removeAttribute('data-bookmark-index');
        return { skipped: false, name: nav.getSelectedBookmark()?.name || null };
    });

    test.skip(result.skipped, 'keyboard navigation unavailable');
    expect(result.name).toBe('Keyboard B');
});
