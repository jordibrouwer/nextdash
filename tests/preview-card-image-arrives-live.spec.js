// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The picture arrives after the card does, and has to land on the open card.
 *
 * The server answers a first hover with everything except the image — it has
 * only just learned the address and fetches it in the background, so the card
 * appears at once instead of waiting on someone else's host. The cost was that
 * the answer got cached twice, on the element and on the bookmark, and every
 * later hover replied from that cache. The picture then showed up only after a
 * page reload, which is not a thing anyone should have to do.
 *
 * The preview is stubbed rather than driven through a real site: the point
 * under test is what the card does between a pending answer and a finished
 * one, and that needs both, in that order, on demand.
 */

const PENDING = {
    url: 'https://site.example.invalid/page',
    title: 'Pending Example',
    description: 'The picture is still on its way.',
    image: '',
    imageSource: 'https://og.example.invalid/og.png',
    domain: 'site.example.invalid',
    fetchedAt: Date.now(),
};
const FINISHED = { ...PENDING, image: '/data/preview-images/pi-livetest.png' };

// A 1x1 PNG, so the browser really decodes something.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

test('the picture lands on the open card, with no reload', async ({ page }) => {
    let previewCalls = 0;
    await page.route('**/api/bookmark-preview*', async (route) => {
        previewCalls += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            // First answer pending, every one after it finished — the shape the
            // background fetch actually produces.
            body: JSON.stringify(previewCalls === 1 ? PENDING : FINISHED),
        });
    });
    await page.route('**/data/preview-images/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async (url) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: window.dashboardInstance.currentPageId,
                bookmark: { name: 'Pending Example', url },
            }),
        });
    }, PENDING.url);

    // Reloaded so the row is drawn from what the server stored: adding through
    // the API does not put the bookmark into the page's own list.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = 'hover';
        d.settings.showLinkPreviewCards = true;
        d.settings.linkPreviewHoverDelayMs = 50;
        d.renderDashboard({ animate: false, forceFull: true });
    });

    const link = page.locator('.bookmark-link', { hasText: 'Pending Example' }).locator('.bookmark-open').first();
    await expect(link).toBeVisible();
    await link.hover();

    const card = page.locator('.bookmark-preview-card');
    await expect(card).toHaveClass(/is-visible/);
    await expect(card.locator('.bookmark-preview-card-title')).toHaveText('Pending Example');

    // Nothing yet — the address had only just been learned.
    const img = card.locator('.bookmark-preview-card-image');
    expect(await img.getAttribute('src')).toBeFalsy();

    // And then it arrives, on the card that is already open. No reload, no
    // second hover: the card is never touched again after this point.
    await expect(img).toHaveAttribute('src', '/data/preview-images/pi-livetest.png', { timeout: 6000 });
    await expect(card).toHaveClass(/is-visible/);
    expect(await img.evaluate((el) => /** @type {HTMLImageElement} */ (el).naturalWidth > 0)).toBe(true);
});

test('a preview with no picture at all is not re-asked forever', async ({ page }) => {
    let previewCalls = 0;
    await page.route('**/api/bookmark-preview*', async (route) => {
        previewCalls += 1;
        // No imageSource: this site simply has none, which is most of them.
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...PENDING, imageSource: '' }),
        });
    });

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async (url) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: window.dashboardInstance.currentPageId,
                bookmark: { name: 'No Picture', url },
            }),
        });
    }, 'https://nopicture.example.invalid/');

    // Reloaded so the row is drawn from what the server stored: adding through
    // the API does not put the bookmark into the page's own list.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = 'hover';
        d.settings.showLinkPreviewCards = true;
        d.settings.linkPreviewHoverDelayMs = 50;
        d.renderDashboard({ animate: false, forceFull: true });
    });

    const link = page.locator('.bookmark-link', { hasText: 'No Picture' }).locator('.bookmark-open').first();
    await link.hover();
    await expect(page.locator('.bookmark-preview-card')).toHaveClass(/is-visible/);

    const afterFirst = previewCalls;
    await page.waitForTimeout(3000);
    expect(previewCalls, 'a site with no picture was polled anyway').toBe(afterFirst);
});

/**
 * The endpoint allows 60 calls a minute and shares that budget with everything
 * else behind the SSRF gate. Letting a pending picture bypass the page's own
 * memo on every hover blew straight through it: the calls came back 429, the
 * card had nothing to draw, and preview cards stopped opening at all.
 */
test('a picture that never arrives does not flood the endpoint', async ({ page }) => {
    let previewCalls = 0;
    await page.route('**/api/bookmark-preview*', async (route) => {
        previewCalls += 1;
        // Always pending: the picture is on a host that never answers, which is
        // the case that used to retry forever.
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(PENDING),
        });
    });

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async (url) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: window.dashboardInstance.currentPageId,
                bookmark: { name: 'Never Arrives', url },
            }),
        });
    }, 'https://never.example.invalid/');

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = 'hover';
        d.settings.showLinkPreviewCards = true;
        d.settings.linkPreviewHoverDelayMs = 50;
        d.renderDashboard({ animate: false, forceFull: true });
    });

    const link = page.locator('.bookmark-link', { hasText: 'Never Arrives' }).locator('.bookmark-open').first();
    await expect(link).toBeVisible();

    // Eight passes over the same row, well inside the window a pending answer
    // is reused for.
    for (let i = 0; i < 8; i++) {
        await link.hover();
        await page.waitForTimeout(250);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(100);
    }
    await page.waitForTimeout(2000);

    // One for the first hover, at most one refill. Anything per-hover is the
    // flood this guards against.
    expect(previewCalls, `${previewCalls} calls for one bookmark`).toBeLessThanOrEqual(2);

    // And the card still opens, which is what the 429s took away.
    await link.hover();
    await expect(page.locator('.bookmark-preview-card')).toHaveClass(/is-visible/);
});
