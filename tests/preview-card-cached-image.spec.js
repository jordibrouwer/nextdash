// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The card draws the cached copy, which lives on our own origin.
 *
 * preview.image used to be the site's own address and went through
 * safeHttpResourceUrl, which exists to reject javascript: and data: and
 * therefore demands an http(s) URL. Once the image became a local path the
 * same call threw it away, so the card showed a favicon (resolved by a helper
 * that already understood /data/ paths) and no picture at all.
 *
 * Only our own prefix is accepted. A stored remote address is not merely
 * unnecessary now — drawing one is the leak this feature exists to close.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** What the card's <img> ends up with for a given preview.image. */
async function imageSrcFor(page, image) {
    return page.evaluate((img) => {
        const d = window.dashboardInstance;
        const card = d.preview.ensureBookmarkPreviewCard();
        const bookmark = { name: 'Example', url: 'https://example.com/' };
        const payload = d.preview.buildPreviewPayload(bookmark, {
            title: 'Example', description: '', image: img, url: bookmark.url,
        });
        d.preview.paintPreviewCard(card, payload, { mode: 'peek' });
        const el = card.querySelector('.bookmark-preview-card-image');
        const wrap = card.querySelector('.bookmark-preview-card-image-wrap');
        return { src: el?.getAttribute('src') || '', shown: !!wrap && !wrap.hidden };
    }, image);
}

test('a cached image on our own origin is drawn', async ({ page }) => {
    await openDashboard(page);
    const got = await imageSrcFor(page, '/data/preview-images/pi-abc123.png');
    expect(got.src, 'the cached copy was thrown away, so the card shows no picture').toBe('/data/preview-images/pi-abc123.png');
    expect(got.shown).toBe(true);
});

test('a remote address is refused, cached or not', async ({ page }) => {
    await openDashboard(page);
    const got = await imageSrcFor(page, 'https://og.example.invalid/og.png');
    expect(got.src, 'drawing a remote image is the leak this feature closes').toBe('');
    expect(got.shown).toBe(false);
});

test('a javascript: url stays refused', async ({ page }) => {
    await openDashboard(page);
    // eslint-disable-next-line no-script-url
    const got = await imageSrcFor(page, 'javascript:alert(1)');
    expect(got.src).toBe('');
});

test('a path that only looks like ours is refused', async ({ page }) => {
    await openDashboard(page);
    const got = await imageSrcFor(page, '/data/../etc/passwd');
    expect(got.src).toBe('');
});
