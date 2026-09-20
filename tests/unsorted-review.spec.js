// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Working through the kept list one link at a time.
 *
 * The list is a grid: it shows what is there and asks nothing. Every link in
 * it is a decision somebody postponed, and the way those get made is one at a
 * time, with the link in front of you and the answers under it -- which is
 * exactly what the queue next door does with `t`. Same card, kept's own
 * answers: file it, tag it, park it, throw it away.
 */

const KEPT = [
    { name: 'Review One', url: 'https://review.example/one', createdAt: 5000 },
    { name: 'Review Two', url: 'https://review.example/two', createdAt: 4000 },
];

async function openKept(page, kept = KEPT) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (rows) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (const bookmark of rows) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none',
        });
        await window.dashboardInstance.loadAllBookmarks?.();
    }, kept);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView({ tab: 'kept' }));
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible();
}

test('f walks the kept list one card at a time, and counts', async ({ page }) => {
    await openKept(page);

    await page.keyboard.press('f');
    const card = page.locator('.unsorted-review-card');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Review One');
    await expect(card.locator('.unsorted-review-progress')).toHaveText('1 / 2');

    // j goes on to the next, k comes back, the way the queue's own card moves.
    await page.keyboard.press('j');
    await expect(card).toContainText('Review Two');
    await expect(card.locator('.unsorted-review-progress')).toHaveText('2 / 2');
    await page.keyboard.press('k');
    await expect(card).toContainText('Review One');

    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
});

test('the card files, parks and deletes the link in front of you', async ({ page }) => {
    await openKept(page, [{ name: 'Park Card', url: 'https://review.example/park', createdAt: 5000 }]);

    await page.keyboard.press('f');
    const card = page.locator('.unsorted-review-card');
    await expect(card).toBeVisible({ timeout: 10_000 });
    // Every answer a kept link can be given is on the card: where it goes, what
    // it is called, and the two ways out.
    for (const action of ['move', 'snooze', 'inbox', 'delete', 'skip']) {
        await expect(card.locator(`[data-review-action="${action}"]`)).toBeVisible();
    }

    await card.locator('[data-review-action="delete"]').click();
    await expect.poll(async () => page.evaluate(async () => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === 'https://review.example/park');
    }), { timeout: 20_000 }).toBe(false);
    // The list ran out, so the run ends with what it got through.
    await expect(page.locator('.unsorted-review-done')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.unsorted-review-done')).toContainText('1');
});

/**
 * The run has a way in that is not a keystroke.
 *
 * The queue's own band carries a Triage button beside its kbd hint, because a
 * ritual nobody can see is a ritual nobody starts. The kept list had `f` and
 * a line in the legend under two hundred rows.
 */
test('the band offers the run, beside the fetch buttons', async ({ page }) => {
    await openKept(page);

    const btn = page.locator('.unsorted-view-review-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('f');

    await btn.click();
    await expect(page.locator('.unsorted-review-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.unsorted-review-card')).toContainText('Review One');
});

/**
 * What the card has to show to be worth stopping at.
 *
 * It borrowed the queue's card, whose body is a two-column grid with a
 * thumbnail on the left -- so a card with no thumbnail put the title and the
 * address in the 6.5rem column meant for the image, and both wrapped to
 * ribbons. And the two facts that decide a kept link, the tags it already
 * carries and how long it has been waiting, were not on it at all.
 */
test('the card gives the title room, and shows the tags and the age', async ({ page }) => {
    await openKept(page, [{
        name: 'A rather long kept bookmark title that needs room',
        url: 'https://review.example/a-long-address-that-also-needs-room',
        createdAt: Date.now() - 40 * 86400000,
        tags: ['reading', 'later'],
    }]);

    await page.keyboard.press('f');
    const card = page.locator('.unsorted-review-card');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // The title gets the card's width, not the thumbnail's column.
    const width = await card.locator('.inbox-triage-title').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(300);

    await expect(card.locator('.unsorted-review-own-tags')).toContainText('reading');
    await expect(card.locator('.unsorted-review-own-tags')).toContainText('later');
    await expect(card.locator('.inbox-triage-meta')).toContainText('1mo');
});
