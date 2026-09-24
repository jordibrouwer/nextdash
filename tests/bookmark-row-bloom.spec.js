// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The keyboard cursor's glow has room to fade.
 *
 * A bookmark list clips: it is `overflow: hidden` so a category can collapse,
 * and a horizontal `visible` beside a vertical `hidden` computes to `auto`, so
 * both axes clip at the padding box. The selected row's bloom (12px) was cut
 * off square at the end of the row — a pale block with a hard edge where a
 * soft halo belongs.
 *
 * The clip box is given the blur as padding and the box is pulled back by the
 * same amount, so this checks both halves: the room is there, and no row moved
 * or narrowed to pay for it.
 */
test('the selected row can fade out at both ends, without moving the rows', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    const geo = await page.evaluate(() => {
        const row = document.querySelector('.category .bookmarks-list .bookmark-link');
        if (!row) return null;
        row.classList.add('keyboard-selected');
        const list = row.closest('.bookmarks-list');
        const body = row.closest('.category-body');
        const r = row.getBoundingClientRect();
        const l = list.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        return {
            leftRoom: Math.round(r.left - l.left),
            rightRoom: Math.round(l.right - r.right),
            topRoom: Math.round(r.top - l.top),
            rowLeft: Math.round(r.left),
            rowRight: Math.round(r.right),
            bodyLeft: Math.round(b.left),
            bodyRight: Math.round(b.right),
            scrollWidth: list.scrollWidth,
            clientWidth: list.clientWidth,
            bloom: getComputedStyle(row).boxShadow,
        };
    });

    expect(geo).not.toBeNull();
    // The glow is what this is about; a flat depth switches it off entirely.
    if (geo.bloom && geo.bloom !== 'none') {
        expect(geo.leftRoom).toBeGreaterThanOrEqual(10);
        expect(geo.rightRoom).toBeGreaterThanOrEqual(10);
        expect(geo.topRoom).toBeGreaterThanOrEqual(4);
    }
    // And the row still spans its category exactly as it did.
    expect(geo.rowLeft).toBe(geo.bodyLeft);
    expect(geo.rowRight).toBe(geo.bodyRight);
    // The room is not scrollable space: nothing to scroll sideways.
    expect(geo.scrollWidth).toBe(geo.clientWidth);
});
