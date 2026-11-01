// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, headers, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

/**
 * Watched news on a real touch screen, and on WebKit. Every interaction is a
 * tap or a touch scroll. The first group runs against the real server (the
 * stub site publishes, the server polls), the paper and hit-test groups use
 * stubbed watch routes. Under `--browser=webkit` the same file proves that no
 * blur or backdrop layer swallows a tap. Polling is global on the shared
 * server, so these run one after the other.
 */
test.describe.configure({ mode: 'serial' });

let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

const link = (page) => row(page, 'Stub Blog');
const badge = (page) => link(page).locator('.bookmark-news-badge');
const pop = (page) => page.locator('.feed-news-pop');
const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');
const newsButton = (page) => page.locator('#feed-news-btn');

/** Watch the stub feed, publish `count` posts and let the server poll once. */
async function publish(request, count) {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
    })).ok()).toBe(true);
    for (let i = 0; i < count; i += 1) site.add(`Post ${i + 2}`);
    expect((await request.post('/api/feeds/watch/poll', { headers, data: {} })).ok()).toBe(true);
}

/** The stored unread count of the one watched bookmark. */
async function storedCount(request) {
    const list = await (await request.get('/api/feeds/watch')).json();
    const entry = Object.values(list.watches || {})[0];
    return entry ? entry.newCount : null;
}

async function stubLongNews(page, count = 14) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = Array.from({ length: count }, (_, i) => ({
        ...newsItem(i + 1, { summary: `<p>${'Long lead text. '.repeat(40)}</p>` }),
        bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts', feedUrl: 'http://127.0.0.1:1/feed/', unread: true,
    }));
    await stubWatch(page, { list: watchPayload(key, items), items });
}

/**
 * A finger drag up on the element: a real touch scroll in Chromium. Mobile
 * WebKit supports neither CDP nor the wheel, so there the nearest scroller
 * is scrolled by script (the scroll events are the same, the gesture is not).
 */
async function touchScroll(page, locator, distance = 400, at = null) {
    const box = locator ? /** @type {{x:number,y:number,width:number,height:number}} */ (await locator.boundingBox()) : null;
    const x = at ? at.x : box.x + box.width / 2;
    const y = at ? at.y : box.y + box.height / 2;
    if (page.context().browser()?.browserType().name() === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: -distance, gestureSourceType: 'touch', speed: 800 });
        await cdp.detach();
    } else {
        await page.evaluate(({ px, py, dy }) => {
            let el = document.elementFromPoint(px, py);
            while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement;
            (el && el !== document.body && el !== document.documentElement ? el : window).scrollBy(0, dy);
        }, { px: x, py: y, dy: distance });
    }
}

const lockOf = (page) => page.evaluate(() => ({
    locked: window.ScrollLock.isLocked(),
    overflow: getComputedStyle(document.body).overflow,
}));

test.describe('on a touch screen, against the real server', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('tapping a headline opens the article in a new page and the badge drops by exactly one', async ({ page, request, context }) => {
        await publish(request, 3);
        await openDashboard(page);
        await expect(badge(page)).toHaveText('3');
        await badge(page).tap();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(3);
        const opened = context.waitForEvent('page');
        await pop(page).locator('.feed-news-pop-item').nth(1).tap();
        const tab = await opened;
        expect(tab.url()).toContain(site.base);
        await expect.poll(() => storedCount(request)).toBe(2);
        await expect(badge(page)).toHaveText('2');
    });

    test('a tap outside, a page scroll and a second tap on the badge each close the popover', async ({ page, request }) => {
        await publish(request, 3);
        await openDashboard(page);
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await page.locator('#dashboard-layout').tap({ position: { x: 5, y: 5 } });
        await expect(pop(page)).toHaveCount(0);

        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        // One bookmark does not make the page scroll; give it somewhere to go.
        await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div style="height:3000px"></div>'); });
        await touchScroll(page, null, 200, { x: 187, y: 760 });
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await expect(pop(page)).toHaveCount(0);

        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await badge(page).tap();
        await expect(pop(page)).toHaveCount(0);
        // None of it read anything.
        expect(await storedCount(request)).toBe(3);
    });

    test('the News button opens the paper in one column, and Mark all read clears the badge and the button', async ({ page, request }) => {
        await publish(request, 3);
        await openDashboard(page);
        await expect(newsButton(page)).toBeVisible();
        await expect(newsButton(page)).toHaveText('3');
        // On a phone it takes the place of What's new.
        await expect(page.locator('#whats-new-btn')).toBeHidden();
        await newsButton(page).tap();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('.feed-news-section:not(.is-earlier)')).toHaveCount(1);
        expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth)).toBe(true);
        const markAll = modal(page).locator('[data-feed-news-mark-all]');
        expect((await markAll.boundingBox()).height).toBeGreaterThanOrEqual(43.9);
        await markAll.tap();
        await expect.poll(() => storedCount(request)).toBe(0);
        await expect(badge(page)).toHaveCount(0);
        await modal(page).locator('[data-feed-news-close]').tap();
        await expect(modal(page)).toBeHidden();
        await expect(newsButton(page)).toBeHidden();
    });
});

test.describe('the paper on a touch screen', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('one column, 44 px controls, three layouts, and the body scrolls under a finger', async ({ page }) => {
        await stubLongNews(page);
        await openDashboard(page);
        await expect(newsButton(page)).toBeVisible();
        await newsButton(page).tap();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page)).toHaveClass(/is-paper/);
        expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await modal(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        // One column of sections: each starts below the one before.
        const sections = await modal(page).locator('.feed-news-section').evaluateAll((els) => els.map((el) => {
            const r = el.getBoundingClientRect();
            return { left: Math.round(r.left), top: r.top, bottom: r.bottom };
        }));
        sections.forEach((s, i) => { if (i) { expect(s.left).toBe(sections[0].left); expect(s.top).toBeGreaterThanOrEqual(sections[i - 1].bottom - 1); } });

        for (const sel of ['[data-feed-news-close]', '[data-feed-news-mark-all]', '.feed-news-toggle']) {
            for (const el of await modal(page).locator(sel).all()) {
                const box = /** @type {{width:number,height:number}} */ (await el.boundingBox());
                expect(box.height, sel).toBeGreaterThanOrEqual(43.9);
                expect(box.width, sel).toBeGreaterThanOrEqual(43.9);
            }
        }
        await expect(modal(page).locator('[data-feed-news-view]')).toHaveCount(3);

        const body = modal(page).locator('.modal-body');
        expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight + 50)).toBe(true);
        await touchScroll(page, body);
        await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    });

    test('the layout switcher buttons are 44 px targets', async ({ page }) => {
        await stubLongNews(page);
        await openDashboard(page);
        await newsButton(page).tap();
        await expect(modal(page)).toBeVisible();
        for (const el of await modal(page).locator('.feed-news-view').all()) {
            const box = /** @type {{width:number,height:number}} */ (await el.boundingBox());
            expect(box.height).toBeGreaterThanOrEqual(43.9);
            expect(box.width).toBeGreaterThanOrEqual(43.9);
        }
    });
});

// The Safari bug class: a blur or backdrop-filter layer that sits over a
// control and swallows the tap. Whatever sits at the centre of a tappable
// control has to be that control or one of its children.
test.describe('hit testing and scroll lock', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    const hitsControl = (locator) => locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(top && (top === el || el.contains(top)));
    });

    test('nothing covers the popover controls, and closing leaves no scroll lock', async ({ page, request }) => {
        await publish(request, 3);
        await openDashboard(page);
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        for (const sel of ['[data-pop-close]', '.feed-news-pop-item']) {
            for (const el of await pop(page).locator(sel).all()) expect(await hitsControl(el), sel).toBe(true);
        }
        await pop(page).locator('[data-pop-close]').tap();
        await expect(pop(page)).toHaveCount(0);
        const state = await lockOf(page);
        expect(state.locked).toBe(false);
        expect(state.overflow).not.toBe('hidden');
    });

    test('nothing covers the news controls, the modal scrolls, and closing releases the lock', async ({ page }) => {
        await stubLongNews(page);
        await openDashboard(page);
        await expect(newsButton(page)).toBeVisible();
        expect(await hitsControl(newsButton(page))).toBe(true);
        await newsButton(page).tap();
        await expect(modal(page)).toBeVisible();
        expect((await lockOf(page)).locked).toBe(true);
        for (const sel of ['[data-feed-news-close]', '[data-feed-news-mark-all]', '[data-feed-news-view="single"]', '[data-feed-news-view="wide"]', '[data-feed-news-view="paper"]']) {
            const el = modal(page).locator(sel).first();
            await expect(el, sel).toBeVisible();
            expect(await hitsControl(el), sel).toBe(true);
        }
        const first = modal(page).locator('.feed-news-entry').first();
        expect(await hitsControl(first)).toBe(true);
        const body = modal(page).locator('.modal-body');
        await touchScroll(page, body);
        await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

        await modal(page).locator('[data-feed-news-close]').tap();
        await expect(modal(page)).toBeHidden();
        await expect.poll(async () => (await lockOf(page)).locked).toBe(false);
        expect((await lockOf(page)).overflow).not.toBe('hidden');
    });
});
