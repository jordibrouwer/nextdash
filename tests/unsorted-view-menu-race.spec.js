// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * DashboardUnsorted.render() is a full innerHTML wipe, not an incremental
 * patch. A background refresh (refreshIfDataRevisionChanged,
 * repaintBookmarkMutationSurfaces) firing while a row's context menu or
 * row popover is open used to detach the row the popover is anchored
 * to -- the popover's own position code gives up on a 0x0 rect rather than
 * guess, so it rendered wherever the browser default put it (the viewport's
 * top-left corner) instead of beside the row. loadAndRender() now skips the
 * rebuild while any of the row popovers are open.
 */
test('a background refresh does not detach the row under an open context menu', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.unsorted != null, null, { timeout: 15_000 });

    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Race row', url: `https://race-${Date.now()}.example`, category: '' } }),
        });
    });

    await page.evaluate(() => window.dashboardInstance.unsorted.openUnsortedView());
    await expect(page.locator('.unsorted-view')).toBeVisible();
    const row = page.locator('.bookmark-link', { hasText: 'Race row' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Dispatched rather than a real right-click: what this test is about is
    // the loadAndRender() guard below, not the click mechanics already
    // covered by move-popover-unsorted.spec.js.
    await row.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5,
        }));
    });
    await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });

    // Simulate the background poll that used to tear the row out from under
    // the open menu.
    const sameNode = await page.evaluate(async () => {
        const before = document.querySelector('.bookmark-link');
        await window.dashboardInstance.unsorted.loadAndRender();
        return document.querySelector('.bookmark-link') === before;
    });
    expect(sameNode, 'the row was rebuilt while its context menu was open').toBe(true);

    // Tags rather than Move to...: the Unsorted menu no longer carries Move --
    // a kept bookmark is filed by giving it a category in Edit, not by being
    // shoved at a page -- and this test is about a popover finding the row it
    // hangs off, which the tag popover anchors the same way.
    await page.click('#bookmark-context-menu [data-action="tags"]');
    const pop = page.locator('#tag-popover');
    await expect(pop).toBeVisible({ timeout: 5_000 });
    const box = await pop.boundingBox();
    // Not the unpositioned top-left corner fallback.
    expect(box.x > 10 || box.y > 10, `popover at (${box.x}, ${box.y}), expected beside the row`).toBe(true);
});
