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

    test('the list has the Overview, three groups and a row per part', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await expect(win.locator('.digest-list-group')).toHaveCount(4);
        await expect(win.locator('.digest-list-group').nth(0)).toContainText('Overview');
        await expect(win.locator('.digest-list-group').nth(1)).toContainText('Needs you');
        await expect(win.locator('.digest-list-group').nth(2)).toContainText('Tidy up');
        await expect(win.locator('.digest-list-group').nth(3)).toContainText('Good to know');
        for (const id of ['broken', 'certificates', 'domains', 'updates', 'never', 'stale', 'inbox', 'top', 'news']) {
            await expect(win.locator(`.digest-row[data-digest-row="${id}"]`)).toHaveCount(1);
        }
        await expect(win.locator('.digest-row[data-digest-row="broken"] .digest-row-count')).toHaveText('7');
    });

    test('a row shows its part in the detail', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await win.locator('.digest-row[data-digest-row="broken"]').click();
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

    test('the checkup is a part of its own, and starting it opens the checkup', async ({ page }) => {
        const win = await openWindow(page, snapshot({ checkup: { items: 14 } }));
        const row = win.locator('.digest-row[data-digest-row="checkup"]');
        await expect(row.locator('.digest-row-count')).toHaveText('14');
        await row.click();
        await win.locator('[data-digest-go="checkup"]').click();
        await expect(page.locator('.checkup-modal .checkup-window')).toBeVisible();
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

test.describe('the digest window: the week in figures, the Overview and the detail', () => {
    const DAY = 86_400_000;
    const week = { opens: 142, opensPrev: 124, added: 7, addedPrev: 7, uptime: 99.6, uptimePrev: 99.9, outages: 2, inboxNew: 4 };

    test('it opens on the Overview, a line per part with where it stands', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await expect(win.locator('.digest-row[data-digest-row="overview"]')).toHaveClass(/is-selected/);
        const overview = win.locator('.digest-detail [data-digest-part="overview"]');
        await expect(overview).toBeVisible();
        await expect(overview.locator('.digest-line--part')).toHaveCount(9);
        await expect(overview.locator('[data-digest-row="top"]')).toContainText('GitHub');
    });

    test('a line in the Overview opens its part', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        await win.locator('.digest-detail [data-digest-row="certificates"]').click();
        await expect(win.locator('.digest-detail [data-digest-part="certificates"]')).toBeVisible();
        await expect(win.locator('.digest-row[data-digest-row="certificates"]')).toHaveClass(/is-selected/);
    });

    test('the figures sit next to the week before, and only the ones with data show', async ({ page }) => {
        const win = await openWindow(page, snapshot({ week }));
        const stats = win.locator('.digest-stats .digest-stat');
        await expect(stats).toHaveCount(4);
        await expect(stats.nth(0)).toContainText('142');
        await expect(stats.nth(0).locator('.digest-stat-delta')).toHaveText('▲ 18');
        await expect(stats.nth(0).locator('.digest-stat-delta')).toHaveClass(/is-good/);
        await expect(stats.nth(1).locator('.digest-stat-delta')).toHaveText('= 7');
        await expect(stats.nth(2)).toContainText('99.6%');
        await expect(stats.nth(2)).toContainText('2 outages');
        await expect(stats.nth(2).locator('.digest-stat-delta')).toHaveText('▼ 0.3');
        await expect(stats.nth(2).locator('.digest-stat-delta')).toHaveClass(/is-bad/);
        await expect(stats.nth(3)).toContainText('4 new this week');
    });

    test('a snapshot without week figures shows only what it has: the Inbox', async ({ page }) => {
        const win = await openWindow(page, snapshot());
        const stats = win.locator('.digest-stats .digest-stat');
        await expect(stats).toHaveCount(1);
        await expect(stats.first()).toContainText('in the Inbox');
        await expect(stats.first().locator('.digest-stat-delta')).toHaveCount(0);
    });

    test('a snapshot with nothing for the strip draws none', async ({ page }) => {
        const snap = snapshot();
        snap.usage.inbox = 0;
        const win = await openWindow(page, snap);
        await expect(win.locator('.digest-stats')).toHaveCount(0);
    });

    test('a broken link says where, since when and why', async ({ page }) => {
        const brokenItems = [
            { name: 'Old homelab wiki', where: 'Homelab', since: Date.now() - 12 * DAY, error: 'connection refused' },
            { name: 'Ghost blog', where: 'Reading', since: Date.now() - 3 * DAY, error: '404 not found' },
        ];
        const snap = snapshot();
        snap.health.brokenItems = brokenItems;
        const win = await openWindow(page, snap);
        await win.locator('.digest-row[data-digest-row="broken"]').click();
        const lines = win.locator('.digest-detail [data-digest-part="broken"] .digest-line');
        await expect(lines).toHaveCount(2);
        await expect(lines.nth(0)).toContainText('Old homelab wiki');
        await expect(lines.nth(0)).toContainText('Homelab · connection refused');
        await expect(lines.nth(0)).toContainText('down 12 d');
        await expect(win.locator('.digest-detail [data-digest-part="broken"]')).toContainText('and 5 more');
    });

    test('the most opened show their counts, the Inbox its oldest', async ({ page }) => {
        const snap = snapshot();
        snap.usage.topOpenedItems = [{ name: 'GitHub', count: 31 }, { name: 'Proxmox', count: 1 }];
        snap.usage.inboxOldestDays = 42;
        const win = await openWindow(page, snap);
        await win.locator('.digest-row[data-digest-row="top"]').click();
        const top = win.locator('.digest-detail [data-digest-part="top"] .digest-line');
        await expect(top.nth(0)).toContainText('1 · GitHub');
        await expect(top.nth(0)).toContainText('31 opens');
        await expect(top.nth(1)).toContainText('1 open');
        await win.locator('.digest-row[data-digest-row="inbox"]').click();
        await expect(win.locator('.digest-detail [data-digest-part="inbox"]')).toContainText('The oldest has waited 42 days.');
    });
});
