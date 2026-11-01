// @ts-check
const http = require('http');
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, installWithBookmarks, headers } = require('./helpers/feed-watch');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Watch feeds as a place to manage every watched feed: per row the
 * interval and mute, a detail with word filters, pause, retry and stop, ticks
 * with a bulk bar, the toolbar, and the list's keys.
 */
// Polling is global on the shared server, so the tests of this file take turns
// and assert on what is stored rather than on what one round reported.
test.describe.configure({ mode: 'serial' });

const watchFeed = async (request, site, intervalMinutes = 60) => {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes }] },
    })).ok()).toBe(true);
};
const stored = async (request) => (await (await request.get('/api/feeds/watch')).json());
const firstFeed = async (request) => Object.values((await stored(request)).watches)[0].feeds[0];
const poll = (request) => request.post('/api/feeds/watch/poll', { headers, data: {} });

async function openSection(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.locator('[data-config-section="feed-watch"]').click();
    await page.waitForSelector('[data-feed-watch-overview] [data-fwm-more]', { timeout: 15_000 });
}

const list = (page) => page.locator('[data-feed-watch-overview]');
const rows = (page) => list(page).locator('.feed-watch-list-row');

/** A feed that counts how often it is asked, for "a paused feed is not asked". */
async function startCountingSite() {
    let hits = 0;
    let base = '';
    const server = http.createServer((req, res) => {
        if (req.url === '/feed/') {
            hits += 1;
            res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
            res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Counted</title><item><title>One</title><link>${base}/1</link><guid>c1</guid></item></channel></rss>`);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Counted</title><link rel="alternate" type="application/rss+xml" href="/feed/">');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    return {
        url: `${base}/`, base,
        hits: () => hits,
        reset() { hits = 0; },
        close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    };
}

test.describe('one watched feed', () => {
    let site;
    test.beforeEach(async ({ request }) => {
        site = await startStubSite();
        await installWithBookmark(request, site);
        await watchFeed(request, site);
    });
    test.afterEach(async () => { await site.close(); });

    test('the interval chosen on the row is stored', async ({ page, request }) => {
        await openSection(page);
        await expect(rows(page)).toHaveCount(1);
        await rows(page).locator('[data-fwm-interval]').selectOption('360');
        await expect.poll(async () => (await firstFeed(request)).intervalMinutes).toBe(360);
        await expect(rows(page).locator('[data-fwm-interval]')).toHaveValue('360');
    });

    test('mute is stored and the chip says so', async ({ page, request }) => {
        await openSection(page);
        const mute = rows(page).locator('[data-fwm-mute]');
        await expect(mute).toHaveAttribute('aria-pressed', 'false');
        await mute.click();
        await expect.poll(async () => (await firstFeed(request)).muted).toBe(true);
        await expect(rows(page).locator('.feed-watch-list-state')).toHaveText('Muted');
        await expect(rows(page).locator('[data-fwm-mute]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('a word filter keeps an item without the word from being news', async ({ page, request }) => {
        await openSection(page);
        await rows(page).locator('[data-fwm-toggle]').click();
        const detail = list(page).locator('.fwm-detail');
        await expect(detail).toBeVisible();
        const input = detail.locator('[data-fwd-word-input="include"]');
        await input.fill('release');
        await input.press('Enter');
        await expect.poll(async () => (await firstFeed(request)).include).toEqual(['release']);
        await expect(detail.locator('[data-fwd-words="include"] .fwm-chip')).toHaveText(['release×']);
        await expect(rows(page).locator('.feed-watch-list-filter')).toHaveText('Only: release');

        site.add('Weekly notes');
        await poll(request);
        expect(Object.values((await stored(request)).watches)[0].newCount).toBe(0);
        site.add('A new release is out');
        await expect.poll(async () => { await poll(request); return Object.values((await stored(request)).watches)[0].newCount; }).toBe(1);
    });

    test('Open the paper opens the combined paper', async ({ page, request }) => {
        site.add('Paper post');
        await expect.poll(async () => { await poll(request); return Object.values((await stored(request)).watches)[0].newCount; }).toBe(1);
        await openSection(page);
        await list(page).locator('[data-fwm-paper]').click();
        const modal = page.locator('#app-modal .modal.feed-news-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.feed-news-section-name')).toHaveText(['Stub Blog']);
        await expect(modal).toContainText('Paper post');
    });

    test('Stop watching asks first, and Cancel keeps the watch', async ({ page, request }) => {
        await openSection(page);
        await rows(page).locator('[data-fwm-toggle]').click();
        await list(page).locator('.fwm-detail [data-fwl-stop]').click();
        await page.locator('#config-confirm-modal [data-confirm="cancel"]').click();
        expect((await stored(request)).total).toBe(1);
        await list(page).locator('.fwm-detail [data-fwl-stop]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect.poll(async () => (await stored(request)).total).toBe(0);
        await expect(list(page)).toContainText('You are not watching any feed yet');
    });

    test('the keys: j moves, Enter opens, m mutes, Delete stops after a confirm', async ({ page, request }) => {
        await openSection(page);
        // The legend names the keys as chips.
        await expect(list(page).locator('.config-list-keyboard-legend kbd')).toHaveText(['j / k', 'Enter', 'm', 'p', 'Delete']);
        await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('j');
        await expect(rows(page).first()).toHaveClass(/keyboard-selected/);
        // j stayed in the list: the section did not change.
        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('feed-watch');
        await page.keyboard.press('Enter');
        await expect(list(page).locator('.fwm-detail')).toBeVisible();
        await page.keyboard.press('m');
        await expect.poll(async () => (await firstFeed(request)).muted).toBe(true);
        await page.keyboard.press('p');
        await expect.poll(async () => (await firstFeed(request)).paused).toBe(true);
        await expect(rows(page).locator('.feed-watch-list-state')).toHaveText('Paused');
        await page.keyboard.press('Delete');
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect.poll(async () => (await stored(request)).total).toBe(0);
    });

    test('at 375 px the view fits without sideways scroll and its controls are 44 px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await markWhatsNewSeen(page);
        await page.goto('/#config/feed-watch');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForSelector('[data-feed-watch-overview] .feed-watch-list-row', { timeout: 15_000 });
        await rows(page).locator('[data-fwm-tick]').check();
        await rows(page).locator('[data-fwm-toggle]').click();
        await expect(list(page).locator('.fwm-detail')).toBeVisible();
        const out = await page.evaluate(() => {
            const host = document.querySelector('[data-feed-watch-overview]');
            const small = [...host.querySelectorAll('button, select, .fwm-tick, input[type="text"]')]
                .filter((el) => el.offsetParent !== null)
                .map((el) => ({ el: el.outerHTML.slice(0, 60), h: el.getBoundingClientRect().height }))
                .filter((c) => c.h < 43.5);
            const wide = [...host.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
                .map((el) => el.className || el.tagName);
            return { scroll: document.documentElement.scrollWidth - window.innerWidth, small, wide };
        });
        expect(out.scroll).toBeLessThanOrEqual(0);
        expect(out.wide).toEqual([]);
        expect(out.small).toEqual([]);
    });
});

test('a paused feed is not asked when the feeds are polled', async ({ page, request }) => {
    const site = await startCountingSite();
    try {
        await installWithBookmark(request, site, 'Counted Blog');
        await watchFeed(request, site);
        await openSection(page);
        await rows(page).locator('[data-fwm-toggle]').click();
        await list(page).locator('.fwm-detail [data-fwd-pause]').click();
        await expect.poll(async () => (await firstFeed(request)).paused).toBe(true);
        await expect(list(page).locator('.fwm-detail [data-fwd-pause]')).toHaveText('Resume');
        site.reset();
        await poll(request);
        await poll(request);
        expect(site.hits()).toBe(0);
    } finally {
        await site.close();
    }
});

test.describe('two watched feeds', () => {
    let a;
    let b;
    test.beforeEach(async ({ request }) => {
        a = await startStubSite();
        b = await startStubSite();
        await installWithBookmarks(request, [{ name: 'Site A', site: a }, { name: 'Site B', site: b }]);
        await watchFeed(request, a, 60);
        await watchFeed(request, b, 120);
    });
    test.afterEach(async () => { await a.close(); await b.close(); });

    test('tick two rows and set both to every 6 hours', async ({ page, request }) => {
        await openSection(page);
        await expect(rows(page)).toHaveCount(2);
        await rows(page).nth(0).locator('[data-fwm-tick]').check();
        await rows(page).nth(1).locator('[data-fwm-tick]').check();
        const bar = list(page).locator('.fwm-bulk');
        await expect(bar).toContainText('2 selected');
        await bar.locator('[data-fwm-bulk-interval]').selectOption('360');
        await expect.poll(async () => Object.values((await stored(request)).watches)
            .map((w) => w.feeds[0].intervalMinutes)).toEqual([360, 360]);
        await expect(rows(page).nth(0).locator('[data-fwm-interval]')).toHaveValue('360');
        await expect(rows(page).nth(1).locator('[data-fwm-interval]')).toHaveValue('360');
    });

    test('bulk mute, then stop both after one confirm', async ({ page, request }) => {
        await openSection(page);
        await list(page).locator('[data-fwm-tick-all]').check();
        await list(page).locator('[data-fwm-bulk="mute"]').click();
        await expect.poll(async () => Object.values((await stored(request)).watches).map((w) => w.feeds[0].muted)).toEqual([true, true]);
        await list(page).locator('[data-fwm-bulk="stop"]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect.poll(async () => (await stored(request)).total).toBe(0);
    });

    test('Watch more… lists the bookmarks without a watch and opens the picker', async ({ page, request }) => {
        expect((await request.post('/api/feeds/unwatch', { headers, data: { bookmarkUrl: b.url } })).ok()).toBe(true);
        await openSection(page);
        await list(page).locator('[data-fwm-more]').click();
        const chooser = page.locator('[data-fwm-chooser]');
        await expect(chooser).toBeVisible();
        await expect(chooser.locator('[data-fwm-choose]')).toHaveCount(1);
        await expect(chooser.locator('[data-fwm-choose]')).toContainText('Site B');
        await chooser.locator('[data-fwm-choose]').click();
        await expect(page.locator('[data-feed-watch-picker]')).toBeVisible();
        await expect(page.locator('.feed-watch-picker-name')).toHaveText('Site B');
    });
});
