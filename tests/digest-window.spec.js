// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The digest window as a list with a detail pane (static/js/digest-notice.js).
 *
 * The snapshot is served from here rather than built by the server, so the
 * window gets every part at once: what the layout has to hold on a full week.
 */

const NAMES = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

function snapshot(overrides = {}) {
    return {
        dueKey: '2026-10-26',
        generatedAt: Date.now(),
        health: {
            newlyBroken: ['Plex', 'Router admin'], stillBroken: 5, stillBrokenNames: NAMES('Old', 5),
            certsExpiring: ['nas.home (5 days)', 'git.home (12 days)', 'photos.home (26 days)', 'expired.home (-21 days)'],
            domainsExpiring: ['example.nl (41 days)', 'other.cc (184 days)'],
        },
        updates: { available: NAMES('ghcr.io/example/app', 4) },
        usage: {
            topOpened: ['GitHub', 'Proxmox', 'Jellyfin'],
            neverOpened: 20, neverOpenedNames: NAMES('Never', 10),
            stale: 12, staleNames: NAMES('Dust', 10), staleDays: 30,
            inbox: 39,
        },
        news: { releases: ['v1.22.0', 'v1.21.1'], highlights: NAMES('Highlight', 10) },
        ...overrides,
    };
}

async function openWindow(page, snap) {
    await page.route('**/api/digest/latest', (route) => route.fulfill({ json: snap }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.settings && window.DigestNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.localStorage.removeItem('nextdashDigestSeenAt');
        window.localStorage.removeItem('nextdashDigestProgress');
        window.localStorage.removeItem('nextdashDigestCard');
    });
    await page.evaluate(() => window.DigestNotice.openDigest());
    return page.locator('.digest-modal .digest-window');
}

async function insideViewport(page, locator) {
    const box = await locator.boundingBox();
    const size = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
}

test.describe('the digest window layout', () => {
    for (const size of [{ width: 1280, height: 720 }, { width: 375, height: 667 }]) {
        test(`the close buttons stay in view at ${size.width}x${size.height}`, async ({ page }) => {
            await page.setViewportSize(size);
            const win = await openWindow(page, snapshot());
            await expect(win).toBeVisible();
            await insideViewport(page, page.locator('.digest-modal [data-digest-close]').first());
            await insideViewport(page, page.locator('.digest-modal .modal-actions button').first());
        });
    }

    test('the list has three groups and a row per part', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await expect(win.locator('.digest-list-group')).toHaveCount(3);
        await expect(win.locator('.digest-list-group').nth(0)).toContainText('Needs you');
        await expect(win.locator('.digest-list-group').nth(1)).toContainText('Tidy up');
        await expect(win.locator('.digest-list-group').nth(2)).toContainText('Good to know');
        for (const id of ['broken', 'certificates', 'domains', 'updates', 'never', 'stale', 'inbox', 'top', 'news']) {
            await expect(win.locator(`.digest-row[data-digest-row="${id}"]`)).toHaveCount(1);
        }
        await expect(win.locator('.digest-row[data-digest-row="broken"] .digest-row-count')).toHaveText('7');
    });

    test('a row shows its part in the detail', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await expect(win.locator('.digest-detail [data-digest-part="broken"]')).toBeVisible();
        await win.locator('.digest-row[data-digest-row="certificates"]').click();
        await expect(win.locator('.digest-detail [data-digest-part="certificates"]')).toBeVisible();
        await expect(win.locator('.digest-detail [data-digest-part="broken"]')).toHaveCount(0);
        await expect(win.locator('.digest-detail')).toContainText('expired 21 d');
    });

    test('opening it twice does not double the header buttons', async ({ page }) => {
        await openWindow(page, snapshot());
        await page.evaluate(() => window.DigestNotice.openDigest());
        await expect(page.locator('.digest-modal [data-digest-close]')).toHaveCount(1);
        await expect(page.locator('.digest-modal .digest-progress')).toHaveCount(1);
    });

    test('every part says what it is and why there is a notice', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        for (const id of ['broken', 'certificates', 'domains', 'updates', 'never', 'stale', 'inbox', 'top', 'news']) {
            await win.locator(`.digest-row[data-digest-row="${id}"]`).click();
            const intro = win.locator(`.digest-detail [data-digest-part="${id}"] .digest-part-intro`);
            await expect(intro).toHaveCount(1);
            expect((await intro.textContent() || '').length).toBeGreaterThan(40);
        }
        await win.locator('.digest-row[data-digest-row="broken"]').click();
        await expect(win.locator('.digest-part-intro')).toContainText('did not answer at the last check');
    });

    test('the stale part says its 30 days differ from the view\'s own limit', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await win.locator('.digest-row[data-digest-row="stale"]').click();
        const part = win.locator('.digest-detail [data-digest-part="stale"]');
        await expect(part).toContainText('Not opened in 30 days');
        await expect(part).toContainText('The Bookmarks view uses your own limit of 90 days');
    });

    test('a summary sentence leads the window', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await expect(win.locator('.digest-summary')).toContainText('links broke this week');
    });

    test('a part with nothing to show has no row, and is not counted', async ({ page }) => {
        const snap = snapshot();
        delete snap.updates;
        const win = await openWindow(page, snap);
        await expect(win.locator('.digest-row[data-digest-row="updates"]')).toHaveCount(0);
        // Broken, certificates, domains, never opened, not opened lately and the Inbox have a view to open.
        await expect(page.locator('.digest-modal .digest-progress')).toContainText('0 of 6');
    });

    test('the part button still shrinks the digest to the bar, and the close buttons close it', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await win.locator('.digest-row[data-digest-row="inbox"]').click();
        await win.locator('[data-digest-go="inbox"]').click();
        await expect(win).toHaveCount(0);
        await expect(page.locator('.digest-bar')).toBeVisible();

        await page.evaluate(() => window.DigestNotice.openDigest());
        await page.locator('.digest-modal [data-digest-close]').first().click();
        await expect(page.locator('.digest-modal .digest-window')).toHaveCount(0);
    });
});
