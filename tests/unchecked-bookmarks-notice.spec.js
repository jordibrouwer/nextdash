// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The corner card that offers to switch on periodic checking for bookmarks
 * that currently have none. Its own bulk-write endpoint
 * (/api/health/check-mode-all) deliberately refuses to turn checking *on*
 * without an explicit target list — this card supplies exactly that list
 * rather than asking the server to touch "everything".
 */

const PROMO_ID = 'unchecked-bookmarks-notice';
const MIN_TO_OFFER = 20;

/** N fake, unchecked bookmarks, entirely in memory -- no real write. */
function fakeUncheckedBookmarks(n, { pageId = 1 } = {}) {
    return Array.from({ length: n }, (_, i) => ({
        name: `Unchecked ${i}`,
        url: `https://unchecked-${i}.example`,
        pageId,
        checkStatus: false,
        monitor: false,
    }));
}

async function loadWithCardPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        try {
            window.localStorage.removeItem('uncheckedBookmarksNoticeLastShownAt');
            window.localStorage.removeItem('uncheckedBookmarksNoticeDeclineCount');
            window.localStorage.removeItem('uncheckedBookmarksNoticeDismissedForever');
        } catch (e) { /* private window -- the card falls back to always-eligible, fine for these tests */ }
    }, PROMO_ID);
}

test.describe('the Unchecked Bookmarks notice', () => {
    test('offered at 20 unchecked bookmarks, not at 19', async ({ page }) => {
        await loadWithCardPending(page);

        await page.evaluate((bookmarks) => { window.dashboardInstance.allBookmarks = bookmarks; },
            fakeUncheckedBookmarks(MIN_TO_OFFER - 1));
        expect(await page.evaluate(() => window.UncheckedBookmarksNotice.shouldShow())).toBe(false);

        await page.evaluate((bookmarks) => { window.dashboardInstance.allBookmarks = bookmarks; },
            fakeUncheckedBookmarks(MIN_TO_OFFER));
        expect(await page.evaluate(() => window.UncheckedBookmarksNotice.shouldShow())).toBe(true);
    });

    test('not offered again within 30 days of being shown', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate((bookmarks) => { window.dashboardInstance.allBookmarks = bookmarks; },
            fakeUncheckedBookmarks(MIN_TO_OFFER));

        expect(await page.evaluate(() => window.UncheckedBookmarksNotice.shouldShow())).toBe(true);
        await page.evaluate(() => window.UncheckedBookmarksNotice.render());

        // A fresh card instance would gate on cardEl/queue state; shouldShow()
        // alone proves the 30-day gate rather than the "already open" one.
        await page.evaluate(() => window.UncheckedBookmarksNotice.close());
        expect(await page.evaluate(() => window.UncheckedBookmarksNotice.shouldShow())).toBe(false);
    });

    test('first offer has two actions, no permanent opt-out', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate((bookmarks) => { window.dashboardInstance.allBookmarks = bookmarks; },
            fakeUncheckedBookmarks(MIN_TO_OFFER));
        await page.evaluate(() => window.UncheckedBookmarksNotice.render());

        const card = page.locator(`.${PROMO_ID}-card`);
        await expect(card).toBeVisible();
        await expect(card.locator('[data-notice-action="accept"]')).toBeVisible();
        // The × also carries data-notice-action="decline" -- dismissName ties
        // it to the same action as the "No thanks" button, per notice-card.js.
        // The button (not the ×) is what this assertion is about.
        await expect(card.locator('[data-notice-action="decline"]:not([data-notice-dismiss])')).toBeVisible();
        await expect(card.locator('[data-notice-action="stop"]')).toHaveCount(0);
    });

    test('after one decline, the next eligible offer adds "don\'t ask again"', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate((bookmarks) => { window.dashboardInstance.allBookmarks = bookmarks; },
            fakeUncheckedBookmarks(MIN_TO_OFFER));
        await page.evaluate(() => window.UncheckedBookmarksNotice.render());
        await page.locator(`.${PROMO_ID}-card [data-notice-action="decline"]:not([data-notice-dismiss])`).click();
        // close() removes the element after a short teardown transition
        // (TEARDOWN_MS in notice-card.js); wait it out before asking for the
        // card again, rather than racing a still-present outgoing element.
        await expect(page.locator(`.${PROMO_ID}-card`)).toHaveCount(0);

        // Simulate the 30 days having passed rather than waiting for them.
        await page.evaluate(() => window.localStorage.setItem('uncheckedBookmarksNoticeLastShownAt', '0'));
        // Another real corner card's own delayed autoStart may have fired by
        // now and taken the corner -- same reason dashboard-fresh-notice.spec.js
        // clears siblings before asserting. cornerIsFree() excludes only this
        // card's own class, not a sibling's.
        await page.evaluate((cls) => {
            document.querySelectorAll(`.quickstart-card:not(.${cls})`).forEach((el) => el.remove());
        }, `${PROMO_ID}-card`);

        await page.evaluate(() => window.UncheckedBookmarksNotice.render());
        const card = page.locator(`.${PROMO_ID}-card`);
        await expect(card).toBeVisible();
        await expect(card.locator('[data-notice-action="stop"]')).toBeVisible();
    });

    test('"don\'t ask again" stops the card for good', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.localStorage.setItem('uncheckedBookmarksNoticeDeclineCount', '1'));
        await page.evaluate((bookmarks) => { window.dashboardInstance.allBookmarks = bookmarks; },
            fakeUncheckedBookmarks(MIN_TO_OFFER));
        await page.evaluate(() => window.UncheckedBookmarksNotice.render());
        await page.locator(`.${PROMO_ID}-card [data-notice-action="stop"]`).click();

        expect(await page.evaluate(() => window.UncheckedBookmarksNotice.shouldShow())).toBe(false);
    });

    test('accepting switches exactly the offered bookmarks to periodic, in one request', async ({ page, request }) => {
        // Real bookmarks this time -- the accept action writes for real.
        for (let i = 0; i < MIN_TO_OFFER; i += 1) {
            const res = await request.post('/api/bookmarks/add', {
                data: { page: 1, bookmark: { name: `Real unchecked ${i}`, url: `https://real-unchecked-${i}.example`, category: '' } },
                headers: { 'X-NextDash-Token': WRITE_TOKEN },
            });
            expect(res.ok()).toBe(true);
        }

        await loadWithCardPending(page);
        await page.waitForFunction(() => Array.isArray(window.dashboardInstance?.allBookmarks)
            && window.dashboardInstance.allBookmarks.filter((b) => b.url?.startsWith('https://real-unchecked-')).length === 20);

        await page.evaluate(() => window.UncheckedBookmarksNotice.render());
        await page.locator(`.${PROMO_ID}-card [data-notice-action="accept"]`).click();
        await expect(page.locator(`.${PROMO_ID}-card`)).toHaveCount(0, { timeout: 5_000 });

        const after = await request.get('/api/bookmarks?all=true');
        const bookmarks = await after.json();
        const touched = bookmarks.filter((b) => b.url?.startsWith('https://real-unchecked-'));
        expect(touched).toHaveLength(20);
        expect(touched.every((b) => b.checkStatus === true)).toBe(true);
    });
});
