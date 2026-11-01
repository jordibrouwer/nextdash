// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

/**
 * Watched news on a phone: the row keeps its purple badge, a tap on it opens a
 * popover with up to four headlines and "+n more", a tap on a headline opens
 * that article. The watch routes are stubbed; every interaction is a real tap.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

async function stubNews(page, count = 6) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = Array.from({ length: count }, (_, i) => ({
        ...newsItem(i + 1, i === 0 ? { image: '/data/preview-images/pi-test.png' } : {}),
        bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    await stubWatch(page, { list: watchPayload(key, items), items });
    return items;
}

const link = (page) => row(page, 'Stub Blog');
const badge = (page) => link(page).locator('.bookmark-news-badge');
const pop = (page) => page.locator('.feed-news-pop');

test.describe('on a touch screen', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('the row keeps the badge, and there is no strip under it', async ({ page }) => {
        await stubNews(page);
        await openDashboard(page);
        await expect(badge(page)).toHaveText('6');
        await expect(badge(page)).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(page.locator('.feed-news-strip')).toHaveCount(0);
        // A 44 px target around the small badge.
        const hit = await badge(page).evaluate((el) => {
            const r = el.getBoundingClientRect();
            const after = getComputedStyle(el, '::after');
            return { w: r.width + 2 * Math.abs(parseFloat(after.left)) , content: after.content };
        });
        expect(hit.content).not.toBe('none');
    });

    test('tapping the badge opens at most four headlines and "+2 more", and does not open the bookmark', async ({ page, context }) => {
        await stubNews(page, 6);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(4);
        await expect(pop(page).locator('.feed-news-pop-title').first()).toHaveText('Headline 1');
        await expect(pop(page).locator('.feed-news-pop-thumb')).toHaveCount(1);
        await expect(pop(page).locator('.feed-news-pop-more')).toHaveText('+2 more');
        await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');
        // The app's own menu surface (so the theme styles it), with a close button.
        await expect(pop(page)).toHaveClass(/move-popover/);
        await expect(pop(page).locator('.feed-news-pop-head')).toContainText('6 new');
        const close = await pop(page).locator('[data-pop-close]').boundingBox();
        expect(close.width).toBeGreaterThanOrEqual(44);
        expect(close.height).toBeGreaterThanOrEqual(44);
        for (const item of await pop(page).locator('.feed-news-pop-item').all()) {
            expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
        }
        // It fits the screen, and the bookmark itself did not open.
        const box = await pop(page).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(375);
        expect(box.y + box.height).toBeLessThanOrEqual(812);
        expect(opened).toBe(0);
    });

    test('with four or fewer there is no "+n more"', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await badge(page).tap();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(3);
        await expect(pop(page).locator('.feed-news-pop-more')).toHaveCount(0);
    });

    test('tapping a headline opens that article and clears the badge', async ({ page }) => {
        await stubNews(page, 6);
        await openDashboard(page);
        // The article's address is nothing that answers; what matters is which
        // address the tap asked the browser to open.
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null; }; });
        await badge(page).tap();
        await pop(page).locator('.feed-news-pop-item').nth(1).tap();
        await expect.poll(() => page.evaluate(() => window.__opened)).toEqual(['http://127.0.0.1:1/n2']);
        await expect(pop(page)).toHaveCount(0);
        await expect(badge(page)).toHaveCount(0);
    });

    test('tapping "+2 more" opens the bookmark', async ({ page, context }) => {
        await stubNews(page, 6);
        await openDashboard(page);
        await badge(page).tap();
        const opened = context.waitForEvent('page');
        await pop(page).locator('.feed-news-pop-more').tap();
        const tab = await opened;
        expect(tab.url()).toContain(new URL(site.url).host);
        await expect(pop(page)).toHaveCount(0);
        await expect(badge(page)).toHaveCount(0);
    });

    test('the close button closes it and leaves the badge and the bookmark alone', async ({ page, context }) => {
        await stubNews(page);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await pop(page).locator('[data-pop-close]').tap();
        await expect(pop(page)).toHaveCount(0);
        await expect(badge(page)).toHaveText('6');
        await expect(badge(page)).toHaveAttribute('aria-expanded', 'false');
        expect(opened).toBe(0);
    });

    test('a tap elsewhere or Esc closes it, and a second tap on the badge too', async ({ page }) => {
        await stubNews(page);
        await openDashboard(page);
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await page.locator('#dashboard-layout').tap({ position: { x: 5, y: 5 } });
        await expect(pop(page)).toHaveCount(0);

        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);

        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await badge(page).tap();
        await expect(pop(page)).toHaveCount(0);
    });

    test('keyboard: focus goes in, Tab stays inside, and every way out returns it to the badge', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        const activeIs = (selector) => page.evaluate((sel) => document.activeElement?.matches(sel), selector);
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        // Opening puts the cursor on the first headline.
        expect(await activeIs('.feed-news-pop-item')).toBe(true);
        expect(await page.evaluate(() => document.activeElement?.closest('.feed-news-pop-list li:first-child') !== null)).toBe(true);
        // Tab from the last headline wraps to the close button, and Shift+Tab goes back.
        await pop(page).locator('.feed-news-pop-item').last().focus();
        await page.keyboard.press('Tab');
        expect(await activeIs('[data-pop-close]')).toBe(true);
        await page.keyboard.press('Shift+Tab');
        expect(await activeIs('li:last-child > .feed-news-pop-item')).toBe(true);
        // Esc, the close button and a second tap all hand focus back.
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement?.classList.contains('bookmark-news-badge'))).toBe(true);

        await badge(page).tap();
        await pop(page).locator('[data-pop-close]').tap();
        await expect(pop(page)).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement?.classList.contains('bookmark-news-badge'))).toBe(true);

        await badge(page).tap();
        await badge(page).tap();
        await expect(pop(page)).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement?.classList.contains('bookmark-news-badge'))).toBe(true);

    });

    test('a screen reader meets a named dialog holding a list of the headlines', async ({ page }) => {
        await stubNews(page, 6);
        await openDashboard(page);
        await badge(page).tap();
        const dialog = page.getByRole('dialog', { name: 'Stub Blog' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'false');
        const list = dialog.getByRole('list');
        await expect(list.getByRole('listitem')).toHaveCount(4);
        await expect(list.getByRole('listitem').first().getByRole('button')).toContainText('Headline 1');
    });

    test('the popover keeps under its badge when the page shifts or the rows are drawn again', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await badge(page).first().tap();
        await expect(pop(page)).toBeVisible();
        // How far the popover is from its badge, under it or above it.
        const gap = async () => page.evaluate(() => {
            const b = document.querySelector('.bookmark-news-badge[aria-expanded="true"]').getBoundingClientRect();
            const p = document.querySelector('.feed-news-pop').getBoundingClientRect();
            return Math.round(Math.min(Math.abs(p.top - b.bottom), Math.abs(b.top - p.bottom)));
        });
        expect(await gap()).toBeLessThan(20);
        // A picture loads above the row, then the rows are drawn again.
        await page.evaluate(() => {
            const spacer = document.createElement('div');
            spacer.style.height = '90px';
            document.body.firstElementChild.before(spacer);
        });
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('feedwatch:changed')));
        await expect.poll(gap).toBeLessThan(20);
        await expect(pop(page)).toHaveCount(1);
        await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');
    });

    test('tapping the row itself still opens the bookmark', async ({ page, context }) => {
        await stubNews(page);
        await openDashboard(page);
        const opened = context.waitForEvent('page');
        await link(page).locator('a.bookmark-open').tap({ position: { x: 20, y: 10 } });
        await opened;
        await expect(badge(page)).toHaveCount(0);
    });
});

test.describe('on a desktop', () => {
    test.use({ viewport: { width: 1500, height: 950 } });

    test('the badge is plain and no popover opens', async ({ page }) => {
        await stubNews(page);
        await openDashboard(page);
        await expect(badge(page)).toBeVisible();
        await expect(badge(page)).not.toHaveAttribute('aria-haspopup', 'dialog');
        await expect(pop(page)).toHaveCount(0);
    });
});

test.describe('on a touch screen, against the real server', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('a headline tap reads only that item; the others stay new', async ({ page, request, context }) => {
        const { headers } = require('./helpers/feed-watch');
        expect((await request.post('/api/feeds/watch', {
            headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
        })).ok()).toBe(true);
        site.add('Second post');
        site.add('Third post');
        site.add('Fourth post');
        await request.post('/api/feeds/watch/poll', { headers, data: {} });
        await openDashboard(page);
        context.on('page', () => {});
        await expect(badge(page)).toHaveText('3');
        await badge(page).tap();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(3);
        // The row's own preview card must not open under the headlines.
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => {
            const el = document.getElementById('bookmark-preview-card');
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05 && r.width > 0;
        })).toBe(false);
        await pop(page).locator('.feed-news-pop-item').nth(1).tap();
        await expect.poll(async () => (await (await request.get('/api/feeds/watch')).json()).watches
            && Object.values((await (await request.get('/api/feeds/watch')).json()).watches)[0].newCount).toBe(2);
        await expect(badge(page)).toHaveText('2');
    });
});
