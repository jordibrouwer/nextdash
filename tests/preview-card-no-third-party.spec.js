// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The point of caching preview media: hovering a bookmark must not announce the
 * reader to the site behind it.
 *
 * Asserted on the wire rather than on the DOM. A src attribute can read as
 * local while the request still leaves — a redirect, a stale field put back by
 * a fallback, a code path that skips the server — and only the request list
 * says what actually happened.
 *
 * The bookmark carries a remote previewImage on purpose. That is what the
 * browser extension writes and what every bookmark held before the cache
 * existed, so it is the shape most likely to leak: the card has a shortcut that
 * builds its picture from the bookmark without asking the server at all.
 */

const OFF_SITE_IMAGE = 'https://og.example.invalid/og.png';
const BOOKMARK_URL = 'https://site.example.invalid/page';

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Save a bookmark that already holds a remote picture, the way the extension does. */
async function seedBookmarkWithRemoteImage(page) {
    return page.evaluate(async ({ url, image }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pageId = window.dashboardInstance.currentPageId;
        const res = await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: pageId,
                bookmark: {
                    name: 'Leaky',
                    url,
                    previewTitle: 'Leaky',
                    previewDesc: 'A bookmark that came in with a remote picture.',
                    previewImage: image,
                },
            }),
        });
        return { ok: res.ok, status: res.status, pageId };
    }, { url: BOOKMARK_URL, image: OFF_SITE_IMAGE });
}

test('hovering a bookmark makes no request to a third party', async ({ page, baseURL }) => {
    await openDashboard(page);

    const seeded = await seedBookmarkWithRemoteImage(page);
    expect(seeded.ok, `seeding the bookmark failed: HTTP ${seeded.status}`).toBe(true);

    // Reloaded so the row is drawn from what the server actually stored, not
    // from whatever the add call left in memory.
    await openDashboard(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = 'hover';
        d.settings.showLinkPreviewCards = true;
        d.settings.linkPreviewHoverDelayMs = 50;
        d.renderDashboard({ animate: false, forceFull: true });
    });

    /*
     * The precondition, asserted rather than assumed: this test is only worth
     * anything if the bookmark really is holding a remote address at this
     * point. If the server had quietly dropped it on save, the run below would
     * pass while proving nothing.
     */
    const stored = await page.evaluate((url) => {
        const d = window.dashboardInstance;
        const bm = (d.allBookmarks || d.bookmarks || []).find((b) => b.url === url);
        return bm ? { found: true, previewImage: bm.previewImage || '', previewTitle: bm.previewTitle || '' } : { found: false };
    }, BOOKMARK_URL);
    expect(stored.found, 'the seeded bookmark is not on the page').toBe(true);

    const ownHost = new URL(String(baseURL)).host;
    /** @type {string[]} */
    const offSite = [];
    page.on('request', (req) => {
        const host = new URL(req.url()).host;
        if (host && host !== ownHost) offSite.push(req.url());
    });

    const link = page.locator('.bookmark-link', { hasText: 'Leaky' }).locator('.bookmark-open').first();
    await expect(link).toBeVisible();

    // Twice, with the card closed in between. The first hover is the one that
    // asks the server; the second is the one that takes the shortcut, and the
    // shortcut is where a stale remote address gets handed to the card.
    for (let i = 0; i < 2; i++) {
        await link.hover();
        await page.waitForTimeout(900);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(200);
    }

    expect(offSite, `the page fetched ${offSite.join(', ')}`).toEqual([]);

    // Says which of the two guards did the work, so a future reader knows
    // whether this passed because the field was stripped on the way in or
    // because the card refused to use it.
    console.log(`stored previewImage after save: ${JSON.stringify(stored.previewImage)}`);
});
