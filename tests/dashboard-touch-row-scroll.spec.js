// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * With the whole row as the drag handle, a touch anywhere on a bookmark
 * started a drag at touchstart and locked the page's scroll, so a swipe that
 * began on a row could not scroll. On a touch screen the grip over the icon
 * drags; the rest of the row is left to scroll.
 */

test.describe('a touch on a bookmark row', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

    async function open(page) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.waitForSelector('#dashboard-layout .bookmarks-list .bookmark-link .bookmark-reorder-handle', { state: 'attached' });
    }

    /** Touch `selector` inside the first row and report whether a drag began. */
    const touchStarts = (page, selector) => page.evaluate((selector) => {
        // A row a drag instance owns: the first list on screen can be a smart
        // collection, which does not reorder at all.
        const row = window.dashboardInstance.categoryReorderInstances[0].getAllItems()[0];
        const target = selector ? row.querySelector(selector) : row.querySelector('.bookmark-name, .bookmark-open') || row;
        const box = target.getBoundingClientRect();
        const touch = new Touch({ identifier: 1, target, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 });
        target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
        const dragging = document.body.classList.contains('bookmark-dragging');
        target.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
        return { dragging, after: document.body.classList.contains('bookmark-dragging') };
    }, selector);

    test('on its name leaves the page free to scroll', async ({ page }) => {
        await open(page);
        expect((await touchStarts(page, null)).dragging).toBe(false);
    });

    test('on the grip starts a drag, and a cancel ends it', async ({ page }) => {
        await open(page);
        const result = await touchStarts(page, '.bookmark-reorder-handle');
        expect(result.dragging).toBe(true);
        expect(result.after, 'a cancelled touch left the drag on').toBe(false);
    });
});
