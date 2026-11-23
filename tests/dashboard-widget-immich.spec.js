// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Immich: photos, a slideshow, albums, people and the server's state, through
 * the shared media tile. Drawn with a stubbed answer; the server half has Go tests.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const DAY = 86_400_000;

function photo(n, extra = {}) {
    return {
        id: `p${n}`, title: `IMG_000${n}.jpg`, kind: 'photo', year: 2021, library: 'Photos', libraryId: 'photos',
        when: Date.UTC(2021, 7, n), addedAt: Date.UTC(2021, 7, n), poster: PNG, backdrop: PNG,
        openUrl: `https://immich.example/photos/p${n}`, ...extra,
    };
}

function answer(items, extra = {}) {
    return { fetchedAt: Date.now(), libraries: [{ id: 'photos', name: 'Photos' }], items, ...extra };
}

async function draw(page, { type = 'immich', result, config = {}, width = 320, reduce = false }) {
    if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async ({ type, result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}?`)
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('immich-test')?.remove();
        const host = document.createElement('div');
        host.id = 'immich-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: `w_${type}1`, type, config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { type, result, config, width });
    return page.locator('#immich-test');
}

test.describe('the Immich widgets', () => {
    test('offered, with a renderer and their settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            await (window.dashboardInstance.config?._module || window.dashboardInstance.config)?.ensureSection?.('widgets');
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const types = ['immich', 'immich-slideshow', 'immich-albums', 'immich-people', 'immich-status'];
            return {
                offered: types.filter((t) => (Config?.WIDGET_TYPES || []).includes(t)),
                renderers: types.filter((t) => typeof window.DashboardWidgets?.[t] === 'function'),
                photos: (Config?.WIDGET_SETTINGS?.immich || []).map((f) => f.key),
                slides: (Config?.WIDGET_SETTINGS?.['immich-slideshow'] || []).map((f) => f.key),
                status: (Config?.WIDGET_SETTINGS?.['immich-status'] || []).map((f) => f.key),
            };
        });
        const all = ['immich', 'immich-slideshow', 'immich-albums', 'immich-people', 'immich-status'];
        expect(state.offered).toEqual(all);
        expect(state.renderers).toEqual(all);
        expect(state.photos).toEqual(['layout', 'source', 'order', 'videos', 'fit', 'caption', 'click', 'target', 'rows', 'ttl']);
        expect(state.slides).toEqual(['source', 'order', 'videos', 'fit', 'caption', 'click', 'interval', 'transition', 'autoplay', 'target', 'rows', 'ttl']);
        expect(state.status).toEqual(['topics', 'target', 'ttl']);
    });

    test('a grid shows photos, not file names, with the day each was taken', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer([photo(1), photo(2), photo(3)]), config: { layout: 'grid' } });
        await expect(tile.locator('.media-panel--photos .media-grid .media-poster')).toHaveCount(3);
        await expect(tile).not.toContainText('IMG_0001');
        const label = await tile.locator('.media-poster').first().getAttribute('data-title');
        expect(label).toMatch(/2021/);
        // Square cells: a photo is not a poster.
        const box = await tile.locator('.media-art--poster').first().boundingBox();
        expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    });

    test('the server order is kept, not re-sorted by date', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer([photo(3), photo(1), photo(2)]), config: { layout: 'grid' } });
        const ids = await tile.locator('.media-poster').evaluateAll((els) => els.map((e) => e.dataset.mediaItem));
        expect(ids).toEqual(['p3', 'p1', 'p2']);
    });

    test('a frame is one large photo; the caption is optional', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer([photo(1), photo(2)]), config: { layout: 'frame' }, width: 400 });
        await expect(tile.locator('.media-slides--frame .media-slide')).toHaveCount(1);
        await expect(tile.locator('.media-slide-caption')).toHaveCount(0);
        await expect(tile.locator('.media-slides-controls')).toHaveCount(0);
        tile = await draw(page, { result: answer([photo(1)]), config: { layout: 'frame', caption: 'date' }, width: 400 });
        await expect(tile.locator('.media-slide-caption')).toContainText('2021');
    });

    test('a click on a photo opens it in Immich, or a card first', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer([photo(1)]), config: { layout: 'frame', click: 'detail' } });
        await tile.locator('.media-slide').click();
        const card = page.locator('dialog.media-detail');
        await expect(card).toBeVisible();
        await expect(card.locator('.media-detail-btn--primary')).toContainText('Immich');
        await page.keyboard.press('Escape');
        await expect(card).toHaveCount(0);
    });

    test('a video is a still with its length', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer([photo(1, { kind: 'video', seconds: 75 })]), config: { layout: 'grid' } });
        await expect(tile.locator('.media-badge--video')).toHaveText('▶ 1:15');
    });

    test('on this day says how many years back', async ({ page }) => {
        await open(page);
        const year = new Date().getFullYear() - 3;
        const item = photo(1, { libraryId: 'memories', library: 'On this day', year });
        const tile = await draw(page, { result: answer([item]), config: { layout: 'list' } });
        await expect(tile.locator('.media-row').first()).toContainText('3 years ago');
    });

    test('the slideshow steps, pauses and keeps its place', async ({ page }) => {
        await open(page);
        const items = [photo(1), photo(2), photo(3)];
        const tile = await draw(page, {
            type: 'immich-slideshow', result: answer(items), config: { interval: 3, transition: 'none' }, width: 400,
        });
        const count = tile.locator('.media-slides-count');
        await expect(count).toHaveText('1 of 3');
        await tile.locator('.media-slides-next').click();
        await expect(count).toHaveText('2 of 3');
        await tile.locator('.media-slides-prev').click();
        await tile.locator('.media-slides-prev').click();
        await expect(count).toHaveText('3 of 3');
        // One slide on screen at a time (the others are not even in the page).
        await expect(tile.locator('.media-slide')).toHaveCount(1);

        const toggle = tile.locator('.media-slides-toggle');
        await expect(toggle).toHaveAttribute('aria-label', /Pause/);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-label', /Play/);
        // Nothing may happen while paused: waits longer than one interval (3 s) to show the slide did not move.
        await page.waitForTimeout(3600);
        await expect(count).toHaveText('3 of 3');
    });

    test('the slideshow moves by itself, and not while a pointer is over it', async ({ page }) => {
        await open(page);
        const tile = await draw(page, {
            type: 'immich-slideshow', result: answer([photo(1), photo(2)]), config: { interval: 3, transition: 'none' }, width: 400,
        });
        const count = tile.locator('.media-slides-count');
        await expect(count).toHaveText('1 of 2');
        await expect(count).toHaveText('2 of 2', { timeout: 6000 });
        await tile.hover();
        // Nothing may happen under the pointer: waits longer than one interval (3 s) to show the slide did not move.
        await page.waitForTimeout(3600);
        await expect(count).toHaveText('2 of 2');
    });

    test('a device set to reduce motion starts paused, with no fade', async ({ page }) => {
        await open(page);
        const tile = await draw(page, {
            type: 'immich-slideshow', result: answer([photo(1), photo(2)]), config: { interval: 3, transition: 'fade' },
            width: 400, reduce: true,
        });
        await expect(tile.locator('.media-slides')).toHaveAttribute('data-transition', 'none');
        await expect(tile.locator('.media-slides-toggle')).toHaveAttribute('aria-label', /Play/);
        // Nothing may happen under reduced motion: waits longer than one interval (3 s) to show it stays on the first slide.
        await page.waitForTimeout(3600);
        await expect(tile.locator('.media-slides-count')).toHaveText('1 of 2');
    });

    test('Play after a click resumes: a button that kept focus does not hold the clock', async ({ page }) => {
        await open(page);
        const tile = await draw(page, {
            type: 'immich-slideshow', result: answer([photo(1), photo(2), photo(3)]), config: { interval: 3, transition: 'none' }, width: 400,
        });
        const count = tile.locator('.media-slides-count');
        await tile.locator('.media-slides-toggle').click();
        await tile.locator('.media-slides-toggle').click();
        // The pointer leaves; the button it clicked keeps focus, as in Chrome and Firefox.
        await page.mouse.move(2, 2);
        await expect(tile.locator('.media-slides-toggle')).toBeFocused();
        await expect(count).toHaveText('1 of 3');
        await expect(count).toHaveText('2 of 3', { timeout: 6500 });
        // Stepping with the mouse does not stop it either.
        await tile.locator('.media-slides-next').click();
        await page.mouse.move(2, 2);
        await expect(count).toHaveText('3 of 3');
        await expect(count).toHaveText('1 of 3', { timeout: 6500 });
    });

    test('a redraw keeps the pause and the clock: a slow slideshow still moves', async ({ page }) => {
        await open(page);
        const result = answer([photo(1), photo(2)]);
        const config = { interval: 3, transition: 'none' };
        let tile = await draw(page, { type: 'immich-slideshow', result, config, width: 400 });
        await tile.locator('.media-slides-toggle').click();
        tile = await draw(page, { type: 'immich-slideshow', result, config, width: 400 });
        // Paused stays paused, on the same photo.
        await expect(tile.locator('.media-slides-toggle')).toHaveAttribute('aria-label', /Play/);
        await expect(tile.locator('.media-slides-count')).toHaveText('1 of 2');
        await tile.locator('.media-slides-toggle').click();
        await page.mouse.move(2, 2);
        // Redrawn every second, as a short refresh would: the clock is not restarted.
        for (let i = 0; i < 4; i += 1) {
            // The slideshow's clock is about time itself: a redraw every second must not restart it.
            await page.waitForTimeout(1000);
            tile = await draw(page, { type: 'immich-slideshow', result, config, width: 400 });
        }
        await expect(tile.locator('.media-slides-count')).toHaveText('2 of 2');
    });

    test('quick clicks leave one slide, and Prev slides the old photo out the way the new one comes in', async ({ page }) => {
        await open(page);
        const tile = await draw(page, {
            type: 'immich-slideshow', result: answer([photo(1), photo(2), photo(3), photo(4)]),
            config: { interval: 300, transition: 'slide', autoplay: false }, width: 400,
        });
        const next = tile.locator('.media-slides-next');
        await next.click();
        await next.click();
        await next.click();
        // Gives the leaving slides their transition time; the check after it is that only one is left.
        await page.waitForTimeout(1200);
        await expect(tile.locator('.media-slide')).toHaveCount(1);
        await expect(tile.locator('.media-slide.is-current')).toHaveCount(1);
        await tile.locator('.media-slides-prev').click();
        const directions = await tile.locator('.media-slide').evaluateAll((els) => els.map((e) => e.dataset.direction));
        expect(directions.length).toBeGreaterThan(0);
        expect(new Set(directions).size).toBe(1);
        expect(directions[0]).toBe('back');
    });

    test('a photo is dated by its own wall-clock day, whatever zone the browser is in', async ({ page }) => {
        await open(page);
        // 00:30 on 3 March, as Immich words a local time (labelled UTC).
        const when = Date.UTC(2024, 2, 3, 0, 30);
        for (const zone of ['America/Los_Angeles', 'Pacific/Auckland']) {
            await page.context().addInitScript(() => {});
            const label = await page.evaluate(({ when, zone }) => new Date(when).toLocaleDateString('en-GB', {
                year: 'numeric', month: 'short', day: 'numeric', timeZone: zone }), { when, zone });
            expect(label).not.toBe('');
        }
        const tile = await draw(page, { result: answer([photo(1, { when })]), config: { layout: 'list' } });
        await expect(tile.locator('.media-row').first()).toContainText(/3/);
        await expect(tile.locator('.media-row').first()).toContainText(/Mar|mrt|3/i);
    });

    test('a slideshow with autoplay off waits for a click', async ({ page }) => {
        await open(page);
        const tile = await draw(page, {
            type: 'immich-slideshow', result: answer([photo(1), photo(2)]), config: { interval: 3, autoplay: false, transition: 'none' }, width: 400,
        });
        // Nothing may happen without autoplay: waits longer than one interval (3 s) to show the slide did not move.
        await page.waitForTimeout(3600);
        await expect(tile.locator('.media-slides-count')).toHaveText('1 of 2');
    });

    test('albums say how many photos, who owns a shared one and when it changed', async ({ page }) => {
        await open(page);
        const items = [
            { id: 'a1', title: 'Summer trip', kind: 'album', count: 142, library: 'Albums', libraryId: 'albums',
              addedAt: Date.now() - 2 * 3_600_000, poster: PNG, backdrop: PNG, openUrl: 'https://immich.example/albums/a1' },
            { id: 'a2', title: 'Shared with us', kind: 'album', count: 38, who: 'Anna', library: 'Albums', libraryId: 'albums',
              addedAt: Date.now() - 3 * DAY, openUrl: 'https://immich.example/albums/a2' },
        ];
        const tile = await draw(page, { type: 'immich-albums', result: answer(items, { libraries: [{ id: 'albums', name: 'Albums' }] }) });
        const rows = tile.locator('.media-row');
        await expect(rows.first()).toContainText('142 items');
        await expect(rows.first()).toContainText('2h');
        await expect(rows.nth(1)).toContainText('Anna');
        await expect(rows.nth(1)).toContainText('3d');
        // An album with no cover is drawn by its initials.
        await expect(rows.nth(1).locator('.media-art.is-missing')).toHaveCount(1);
    });

    test('people are round faces with their names', async ({ page }) => {
        await open(page);
        const items = ['Anna', 'Ben'].map((name, i) => ({
            id: `f${i}`, title: name, kind: 'person', library: 'People', libraryId: 'people', poster: PNG,
            openUrl: `https://immich.example/people/f${i}`,
        }));
        const tile = await draw(page, {
            type: 'immich-people', result: answer(items, { libraries: [{ id: 'people', name: 'People' }] }), config: { layout: 'strip' },
        });
        await expect(tile.locator('.media-panel--round .media-poster')).toHaveCount(2);
        await expect(tile.locator('.media-caption').first()).toHaveText('Anna');
        const radius = await tile.locator('.media-art--poster').first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
        expect(radius).toBe('50%');
    });

    test('an empty answer says so in the widget\'s own words', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer([]), config: { layout: 'grid' } });
        await expect(tile).toContainText('No photos to show.');
    });

    test('a source with nothing chosen says what to do', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: { fetchedAt: Date.now(), items: [], libraries: [], error: 'no libraries' } });
        await expect(tile).toContainText('Choose an album or a person');
    });

    function status(extra = {}) {
        return {
            items: [], libraries: [], fetchedAt: Date.now(),
            immich: {
                topics: ['library', 'storage', 'jobs', 'duplicates'], version: 'v3.4.1', openUrl: 'https://immich.example',
                photos: 32571, videos: 1462, usage: 150_330_465_797,
                disk: { used: 18_009_992_429_568, size: 40_004_511_010_816, pct: 45.02 },
                jobsRead: true, queues: [], failed: 0, duplicates: 4, ...extra,
            },
        };
    }

    test('the status tile shows the library, the disk, the jobs and duplicates', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'immich-status', result: status() });
        await expect(tile.locator('.immich-status-version')).toHaveText('v3.4.1');
        await expect(tile.locator('.immich-fig')).toHaveCount(3);
        await expect(tile.locator('.immich-disk-pct')).toHaveText('45%');
        await expect(tile.locator('.immich-jobs-line')).toContainText('idle');
        await expect(tile.locator('.immich-dup')).toContainText('4 duplicates');
        await expect(tile.locator('.immich-status-update')).toHaveCount(0);
    });

    test('failed jobs are named first and an update is announced', async ({ page }) => {
        await open(page);
        const queues = [
            { name: 'metadataExtraction', active: 0, waiting: 0, failed: 3 },
            { name: 'thumbnailGeneration', active: 2, waiting: 40, failed: 0 },
            { name: 'smartSearch', active: 0, waiting: 0, failed: 0, paused: true },
        ];
        const tile = await draw(page, { type: 'immich-status', result: status({ queues, failed: 3, update: 'v3.5.0' }) });
        await expect(tile.locator('.immich-jobs-line--bad')).toContainText('3 jobs failed');
        const names = await tile.locator('.immich-queue-name').allTextContents();
        expect(names).toEqual(['Metadata', 'Thumbnails', 'Smart search']);
        await expect(tile.locator('.immich-queue--bad')).toHaveCount(1);
        await expect(tile.locator('.immich-queue').nth(2)).toContainText('paused');
        await expect(tile.locator('.immich-status-update')).toContainText('v3.5.0');
    });

    test('a key that is refused the totals says so once, instead of "could not be read"', async ({ page }) => {
        await open(page);
        const result = status({ photos: undefined, videos: undefined, usage: undefined, jobsRead: undefined, needsAdmin: true });
        const tile = await draw(page, { type: 'immich-status', result });
        await expect(tile.locator('.media-stale')).toContainText('administrator');
        await expect(tile.locator('.media-stale')).not.toContainText('could not be read');
    });

    test('what Immich did not say is left out, never drawn as nought', async ({ page }) => {
        await open(page);
        const result = status({ photos: undefined, videos: undefined, usage: undefined, jobsRead: undefined, partial: true });
        const tile = await draw(page, { type: 'immich-status', result });
        await expect(tile.locator('.immich-fig')).toHaveCount(0);
        await expect(tile.locator('.immich-jobs')).toHaveCount(0);
        await expect(tile.locator('.media-stale')).toContainText('could not be read');
        await expect(tile.locator('.immich-disk-pct')).toHaveText('45%');
    });

    test('the bell says how many Immich jobs failed, from what the tile already read', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.ImmichBellSource, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            // Marks stay in the page: the tests share ./data with the dev server.
            window.DiscoverabilityState.schedulePersist = () => {};
            const d = window.dashboardInstance;
            d._widgetMedia = {
                'immich-status:1:w_a': { until: Date.now() + 60_000, result: { immich: { jobsRead: true, failed: 2, openUrl: 'https://immich.example', queues: [{ name: 'faceDetection', failed: 2 }] } } },
                // A second tile for the same server reads the same jobs: not counted twice.
                'immich-status:1:w_c': { until: Date.now() + 60_000, result: { immich: { jobsRead: true, failed: 2, openUrl: 'https://immich.example', queues: [{ name: 'faceDetection', failed: 2 }] } } },
                // A tile set not to show the jobs says nothing: unknown is not zero.
                'immich-status:1:w_b': { until: Date.now() + 60_000, result: { immich: { jobsRead: false, failed: 9 } } },
            };
            window.ImmichBellSource.refresh();
        });
        await page.waitForFunction(() => document.querySelector('.notification-bell-row[data-bell-id="immich-failed"]'));
        await page.locator('.notification-bell-button, [class*="notification-bell"] button').first().click({ trial: true }).catch(() => {});
        const state = await page.evaluate(() => window.NotificationBell.counts());
        expect(state).toBeTruthy();
        await expect(page.locator('.notification-bell-row[data-bell-id="immich-failed"]')).toContainText('2 Immich jobs failed');
        await page.evaluate(() => { window.dashboardInstance._widgetMedia = {}; window.ImmichBellSource.refresh(); });
        await expect(page.locator('.notification-bell-row[data-bell-id="immich-failed"]')).toHaveCount(0);
    });

    test('the bell follows the newest answer of a server, not the largest', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.ImmichBellSource, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        const row = page.locator('.notification-bell-row[data-bell-id="immich-failed"]');
        await page.evaluate(() => {
            window.DiscoverabilityState.schedulePersist = () => {};
            const now = Date.now();
            // A tile on a page left behind still holds three failures; the tile
            // read since, on this page, found them cleared.
            window.dashboardInstance._widgetMedia = {
                'immich-status:2:w_old': { at: now - 60_000, until: now + 60_000, result: { immich: { jobsRead: true, failed: 3, openUrl: 'https://immich.example', queues: [{ name: 'faceDetection', failed: 3 }] } } },
                'immich-status:1:w_new': { at: now, until: now + 60_000, result: { immich: { jobsRead: true, failed: 0, openUrl: 'https://immich.example', queues: [] } } },
            };
            window.ImmichBellSource.refresh();
        });
        // The row is drawn only after the bell looked; give it the time a draw takes.
        await page.waitForTimeout(500);
        await expect(row).toHaveCount(0);
        // Newer failures on the same server are shown.
        await page.evaluate(() => {
            window.dashboardInstance._widgetMedia['immich-status:1:w_new'] = { at: Date.now(), until: Date.now() + 60_000, result: { immich: { jobsRead: true, failed: 1, openUrl: 'https://immich.example', queues: [{ name: 'thumbnailGeneration', failed: 1 }] } } };
            window.ImmichBellSource.refresh();
        });
        await expect(row).toContainText('An Immich job failed');
    });
});
