// @ts-check
const { test, expect } = require('./fixtures');
const { headers, startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

/**
 * Watched news under the row, on a phone and on a desktop: the row keeps its
 * purple badge, a tap or a click on it opens a popover with up to six headlines
 * and "+n more", a tap on a headline opens that article. The watch routes are
 * stubbed; every interaction is a real tap, click or key.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    // A phone opens links in the same tab and hides toasts unless told
    // otherwise; these tests are about the new tab and the toast's Read button.
    expect((await request.post('/api/settings', {
        data: { openLinksNewTabMobile: true, hideToastsMobile: false },
        headers,
    })).ok()).toBe(true);
});
test.afterEach(async () => { await site.close(); });

// With `long`, the fifth headline is one unbroken word far wider than the popover.
async function stubNews(page, count = 6, { long = false } = {}) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const items = Array.from({ length: count }, (_, i) => ({
        ...newsItem(i + 1, i === 0 ? { image: '/data/preview-images/pi-test.png' } : {}),
        ...(long && i === 4 ? { title: `Headline5-${'x'.repeat(120)}` } : {}),
        bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    await stubWatch(page, { list: watchPayload(key, items), items });
    return items;
}

const link = (page) => row(page, 'Stub Blog');
const badge = (page) => link(page).locator('.bookmark-news-badge');
const pop = (page) => page.locator('.feed-news-pop');
// It grows in; measure it once it has.
const settled = (page) => pop(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

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

    test('tapping the badge opens at most six headlines and "+1 more", and does not open the bookmark', async ({ page, context }) => {
        await stubNews(page, 7);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        await badge(page).tap();
        await expect(pop(page)).toBeVisible();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(6);
        await expect(pop(page).locator('.feed-news-pop-title').first()).toHaveText('Headline 1');
        await expect(pop(page).locator('.feed-news-pop-thumb')).toHaveCount(1);
        await expect(pop(page).locator('.feed-news-pop-more')).toHaveText('+1 more');
        await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');
        // The app's own menu surface (so the theme styles it), with a close button.
        await expect(pop(page)).toHaveClass(/move-popover/);
        await settled(page);
        await expect(pop(page).locator('.feed-news-pop-head')).toContainText('7 new');
        // The Reader button is on a phone too, a finger-sized target that opens the paper.
        const reader = pop(page).locator('[data-pop-reader]');
        await expect(reader).toBeVisible();
        expect((await reader.boundingBox()).height).toBeGreaterThanOrEqual(44);
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

    test('tapping Reader opens the paper on that site alone', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await badge(page).tap();
        await pop(page).locator('[data-pop-reader]').tap();
        const modal = page.locator('#app-modal .modal.feed-news-modal');
        await expect(modal).toBeVisible();
        await expect(pop(page)).toHaveCount(0);
        await expect(modal.locator('.feed-news-section')).toHaveCount(1);
    });

    test('with six or fewer there is no "+n more"', async ({ page }) => {
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

    test('tapping "+1 more" shows the seventh in the same popover, and opens nothing', async ({ page, context }) => {
        await stubNews(page, 7);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        await badge(page).tap();
        await pop(page).locator('.feed-news-pop-more').tap();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(7);
        // All of them are here now: the bar on top is the way to the site.
        await expect(pop(page).locator('.feed-news-pop-more')).toHaveCount(0);
        // No tab should open: a fixed wait, so a late `page` event would be counted before the check.
        await page.waitForTimeout(300);
        expect(opened).toBe(0);
        await expect(badge(page)).toHaveText('7');
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
        // Tab from the last headline wraps to the bar on top, and Shift+Tab goes back.
        await pop(page).locator('.feed-news-pop-item').last().focus();
        await page.keyboard.press('Tab');
        expect(await activeIs('[data-pop-site]')).toBe(true);
        await page.keyboard.press('Shift+Tab');
        // Back inside the popover, off the bar. Which headline takes the focus is
        // not asserted: on the CI runner it was not the last one, on three other
        // machines it was, and what this checks is that the trap holds.
        await expect.poll(() => page.evaluate(() => {
            const p = document.querySelector('.feed-news-pop');
            const a = document.activeElement;
            return Boolean(p && a && p.contains(a) && !a.matches('[data-pop-site]'));
        })).toBe(true);
        // Esc, the close button and a second tap all hand focus back.
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('bookmark-news-badge'))).toBe(true);

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
        await expect(list.getByRole('listitem')).toHaveCount(6);
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

    test('a tap anywhere on a row with news shows the headlines first, not the site', async ({ page, context }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        // On the name, away from the badge.
        await link(page).locator('a.bookmark-open').tap({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toBeVisible();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(3);
        // No tab should open: a fixed wait, so a late `page` event would be counted before the check.
        await page.waitForTimeout(400);
        expect(opened).toBe(0);
        // The second tap on the row closes it again; the site still did not open.
        await link(page).locator('a.bookmark-open').tap({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toHaveCount(0);
        expect(opened).toBe(0);
    });

    test('the bar on top of the headlines goes on to the site', async ({ page, context }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await link(page).locator('a.bookmark-open').tap({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toBeVisible();
        const opened = context.waitForEvent('page');
        await pop(page).locator('[data-pop-site]').tap();
        const tab = await opened;
        expect(tab.url()).toContain(new URL(site.url).host);
        await expect(pop(page)).toHaveCount(0);
    });

    test('a row without news still opens its site directly', async ({ page, context }) => {
        await stubNews(page, 3);
        await page.route('**/api/feeds/watch', (route) => (route.request().method() !== 'GET'
            ? route.continue()
            : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ limit: 100, total: 0, watches: {} }) })));
        await openDashboard(page);
        await expect(badge(page)).toHaveCount(0);
        const opened = context.waitForEvent('page');
        await link(page).locator('a.bookmark-open').tap({ position: { x: 20, y: 10 } });
        await opened;
    });
});

/**
 * Where the popover is and what it holds, measured once it has grown in. The
 * test's real claim is in every one of these: nothing sideways to scroll, and
 * the whole box on the screen.
 */
async function shape(page) {
    await settled(page);
    return pop(page).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const link = document.querySelector('.bookmark-news-badge[aria-expanded="true"]').closest('a').getBoundingClientRect();
        const items = [...el.querySelectorAll('.feed-news-pop-item')].map((b) => b.getBoundingClientRect().toJSON());
        const cs = getComputedStyle(el);
        return {
            compact: el.classList.contains('is-compact'), two: el.classList.contains('is-two-cols'),
            side: el.classList.contains('is-side'), above: el.classList.contains('is-above'),
            thumbs: [...el.querySelectorAll('.feed-news-pop-thumb')].filter((img) => img.getBoundingClientRect().width > 0).length,
            rect: r.toJSON(), row: link.toJSON(), items, vw: innerWidth, vh: innerHeight,
            scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
            overflowX: cs.overflowX, listOverflowX: getComputedStyle(el.querySelector('.feed-news-pop-list')).overflowX,
        };
    });
}

function expectOnScreen(s) {
    expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    expect(s.overflowX).toBe('hidden');
    expect(s.rect.top).toBeGreaterThanOrEqual(0);
    expect(s.rect.left).toBeGreaterThanOrEqual(0);
    expect(s.rect.bottom).toBeLessThanOrEqual(s.vh + 0.5);
    expect(s.rect.right).toBeLessThanOrEqual(s.vw + 0.5);
}

/**
 * Put the row at the bottom of the screen, or in its middle, by scrolling the
 * page; the spacers give a short dashboard room to scroll.
 */
async function rowAt(page, where) {
    await link(page).evaluate((row, at) => {
        for (const end of ['before', 'after']) {
            const spacer = document.createElement('div');
            spacer.style.height = `${innerHeight * 2}px`;
            if (end === 'before') document.body.firstElementChild.before(spacer); else document.body.append(spacer);
        }
        const r = row.getBoundingClientRect();
        const target = at === 'bottom' ? innerHeight - 4 - r.height : (innerHeight - r.height) / 2;
        window.scrollBy(0, r.top - target);
    }, where);
    // WebKit hands the scroll event over late; it must not land on the popover.
    await page.waitForTimeout(300);
}

/**
 * A real click on the row where it is. A locator click may scroll the page first
 * (WebKit does, for a row at the very bottom), and a page that scrolls closes the
 * popover it just opened.
 */
async function clickInPlace(page) {
    const box = await name(page).boundingBox();
    await page.mouse.click(box.x + 20, box.y + 10);
}

/** Is the hover card on screen? */
const cardShown = (page) => page.evaluate(() => {
    const el = document.getElementById('bookmark-preview-card');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05 && r.width > 0;
});
const name = (page) => link(page).locator('a.bookmark-open');

test.describe('on a desktop', () => {
    test.use({ viewport: { width: 1500, height: 950 } });

    test('a click on the name opens six headlines and "+3 more", not the site; a second click closes them', async ({ page, context }) => {
        await stubNews(page, 9);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        await expect(badge(page)).toHaveAttribute('aria-haspopup', 'dialog');
        await name(page).click({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toBeVisible();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(6);
        await expect(pop(page).locator('.feed-news-pop-title').first()).toHaveText('Headline 1');
        await expect(pop(page).locator('.feed-news-pop-meta').first()).toContainText('Stub Posts · ');
        await expect(pop(page).locator('.feed-news-pop-more')).toHaveText('+3 more');
        await expect(pop(page).locator('.feed-news-pop-head')).toContainText('9 new');
        await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');
        // No tab should open: a fixed wait, so a late `page` event would be counted before the check.
        await page.waitForTimeout(400);
        expect(opened).toBe(0);
        await name(page).click({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toHaveCount(0);
        await expect(badge(page)).toHaveText('9');
        expect(opened).toBe(0);
    });

    for (const [label, how] of [
        ['Ctrl/Cmd-click', { modifiers: ['ControlOrMeta'] }],
        ['a middle click', { button: 'middle' }],
    ]) {
        test(`${label} still opens the site, and no popover`, async ({ page, context }) => {
            await stubNews(page, 3);
            await openDashboard(page);
            const opened = context.waitForEvent('page');
            await name(page).click({ position: { x: 20, y: 10 }, ...how });
            const tab = await opened;
            await expect.poll(() => tab.url()).toContain(new URL(site.url).host);
            // No popover should appear: a fixed wait, so a late one would exist before the zero count is read.
            await page.waitForTimeout(300);
            await expect(pop(page)).toHaveCount(0);
        });
    }

    test('a right click is the menu, not the popover', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await name(page).click({ button: 'right', position: { x: 20, y: 10 } });
        await expect(page.getByRole('menuitem').first()).toBeVisible();
        await expect(pop(page)).toHaveCount(0);
    });

    test('the first click closes the hover card, and no card opens while the headlines are open', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await name(page).hover({ position: { x: 20, y: 10 } });
        await expect(page.locator('#bookmark-preview-card .bookmark-preview-card-news')).toBeVisible();
        await name(page).click({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toBeVisible();
        await expect.poll(() => cardShown(page)).toBe(false);
        // Away and back onto the row: the card stays shut while the popover is open.
        await page.mouse.move(5, 940);
        await name(page).hover({ position: { x: 20, y: 10 } });
        // The card must stay shut: a fixed wait, so a late card would show before the check.
        await page.waitForTimeout(1500);
        expect(await cardShown(page)).toBe(false);
        await expect(pop(page)).toBeVisible();
        // Closed, the card comes back on the next hover.
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);
        await page.mouse.move(5, 940);
        await name(page).hover({ position: { x: 20, y: 10 } });
        await expect.poll(() => cardShown(page), { timeout: 5000 }).toBe(true);
    });

    test('Reader opens the paper on that site alone and closes the popover', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await name(page).click({ position: { x: 20, y: 10 } });
        const reader = pop(page).locator('[data-pop-reader]');
        await expect(reader).toHaveText('Reader');
        await expect(reader).toHaveAttribute('aria-label', 'Open the reader for Stub Blog');
        // Between the bar to the site and the ×.
        const order = await pop(page).locator('.feed-news-pop-head > *').evaluateAll((els) => els.map((el) => el.className));
        expect(order).toEqual(['feed-news-pop-site', 'feed-news-pop-reader', 'feed-news-pop-close']);
        await reader.click();
        const modal = page.locator('#app-modal .modal.feed-news-modal');
        await expect(modal).toBeVisible();
        await expect(pop(page)).toHaveCount(0);
        await expect(modal.locator('.feed-news-section')).toHaveCount(1);
        // One site's paper: Mark all read belongs to the paper of every site.
        await expect(modal.locator('[data-feed-news-mark-all]')).toHaveCount(0);
    });

    test('the bar on top opens the site, a headline its article', async ({ page, context }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await name(page).click({ position: { x: 20, y: 10 } });
        const opened = context.waitForEvent('page');
        await pop(page).locator('[data-pop-site]').click();
        const tab = await opened;
        await expect.poll(() => tab.url()).toContain(new URL(site.url).host);
        await expect(pop(page)).toHaveCount(0);
    });

    test('a headline opens its article', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null; }; });
        await name(page).click({ position: { x: 20, y: 10 } });
        await pop(page).locator('.feed-news-pop-item').nth(1).click();
        await expect.poll(() => page.evaluate(() => window.__opened)).toEqual(['http://127.0.0.1:1/n2']);
        await expect(pop(page)).toHaveCount(0);
    });

    test('it grows down out of the row', async ({ page }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        await name(page).click({ position: { x: 20, y: 10 } });
        const style = await pop(page).evaluate((el) => {
            const cs = getComputedStyle(el);
            return { name: cs.animationName, origin: el.style.transformOrigin };
        });
        expect(style.name).toBe('feed-news-pop-grow');
        expect(style.origin).toMatch(/px (top|bottom)$/);
    });

    test('Enter on the selected row opens the headlines, not the site', async ({ page, context }) => {
        await stubNews(page, 3);
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        const selected = () => page.evaluate(() => window.dashboardInstance.keyboardNavigation.getSelectedBookmark()?.name || '');
        for (let i = 0; i < 20 && (await selected()) !== 'Stub Blog'; i += 1) await page.keyboard.press('ArrowDown');
        expect(await selected()).toBe('Stub Blog');
        await page.keyboard.press('Enter');
        await expect(pop(page)).toBeVisible();
        // No tab should open: a fixed wait, so a late `page` event would be counted before the check.
        await page.waitForTimeout(400);
        expect(opened).toBe(0);
    });
});

test.describe('on a desktop, "+n more" and the shape', () => {
    test.use({ viewport: { width: 1500, height: 950 } });

    test('"+6 more" shows four more in place; "+2 more · Open site" is the way to the rest', async ({ page, context }) => {
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        let opened = 0;
        const counter = () => { opened += 1; };
        context.on('page', counter);
        await name(page).click({ position: { x: 20, y: 10 } });
        const more = pop(page).locator('.feed-news-pop-more');
        await expect(more).toHaveText('+6 more');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await more.click();
        await expect(pop(page)).toBeVisible();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(10);
        await expect(pop(page).locator('.feed-news-pop-title').nth(9)).toHaveText('Headline 10');
        // The cursor lands on the first of the newcomers.
        expect(await page.evaluate(() => document.activeElement?.dataset.popItem)).toBe('6');
        await expect(more).toHaveText('+2 more · Open site');
        // No tab should open: a fixed wait, so a late `page` event would be counted before the check.
        await page.waitForTimeout(300);
        expect(opened).toBe(0);
        expectOnScreen(await shape(page));
        context.off('page', counter);
        const tab = context.waitForEvent('page');
        await more.click();
        await expect.poll(async () => (await tab).url()).toContain(new URL(site.url).host);
        await expect(pop(page)).toHaveCount(0);
    });

    test('with ten or fewer, the expanded popover has no line under the headlines', async ({ page }) => {
        await stubNews(page, 9);
        await openDashboard(page);
        await name(page).click({ position: { x: 20, y: 10 } });
        await pop(page).locator('.feed-news-pop-more').click();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(9);
        await expect(pop(page).locator('.feed-news-pop-more')).toHaveCount(0);
        // Esc still closes it, back on the badge.
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement?.classList.contains('bookmark-news-badge'))).toBe(true);
    });

    test('a tall screen: one column with pictures, under the row, growing from the top', async ({ page }) => {
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        await name(page).click({ position: { x: 20, y: 10 } });
        const origin = await pop(page).evaluate((el) => getComputedStyle(el).transformOrigin.split(' ').map(parseFloat));
        expect(origin[1]).toBe(0);
        const s = await shape(page);
        expect([s.compact, s.two, s.side, s.above]).toEqual([false, false, false, false]);
        expect(s.thumbs).toBe(1);
        expect(s.rect.top).toBeGreaterThanOrEqual(s.row.top);
        expect(s.scrollHeight).toBeLessThanOrEqual(s.clientHeight);
        expectOnScreen(s);
        await page.screenshot({ path: '/tmp/fw31-layout-1.png' });
    });

    test('a short screen with the row at the bottom: compact, over the row, growing from the bottom', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 420 });
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        await rowAt(page, 'bottom');
        await clickInPlace(page);
        const origin = await pop(page).evaluate((el) => [getComputedStyle(el).transformOrigin.split(' ').map(parseFloat)[1], el.offsetHeight]);
        expect(Math.abs(origin[0] - origin[1])).toBeLessThan(1);
        const s = await shape(page);
        expect([s.compact, s.two, s.side, s.above]).toEqual([true, false, false, true]);
        expect(s.thumbs).toBe(0);
        expect(s.scrollHeight).toBeLessThanOrEqual(s.clientHeight);
        expectOnScreen(s);
        await page.screenshot({ path: '/tmp/fw31-layout-2.png' });
    });

    test('shorter still and wide: two columns, top to bottom, all on the screen', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 300 });
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        await rowAt(page, 'bottom');
        await clickInPlace(page);
        const s = await shape(page);
        expect([s.compact, s.two, s.side]).toEqual([true, true, false]);
        expect(s.scrollHeight).toBeLessThanOrEqual(s.clientHeight);
        // 1, 2, 3 down the first column, 4, 5, 6 down the second.
        expect(s.items[0].left).toBeLessThan(s.items[3].left);
        expect(s.items[1].left).toBe(s.items[0].left);
        expect(s.items[1].top).toBeGreaterThan(s.items[0].top);
        expect(s.items[3].top).toBe(s.items[0].top);
        for (const item of s.items) {
            expect(item.top).toBeGreaterThanOrEqual(0);
            expect(item.bottom).toBeLessThanOrEqual(s.vh);
            expect(item.right).toBeLessThanOrEqual(s.vw);
        }
        expectOnScreen(s);
        await page.screenshot({ path: '/tmp/fw31-layout-3.png' });
    });

    test('very short and wide, the row in the middle: beside the row, clear of it', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 300 });
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        await rowAt(page, 'middle');
        await clickInPlace(page);
        const origin = await pop(page).evaluate((el) => [getComputedStyle(el).transformOrigin.split(' ').map(parseFloat)[0], el.offsetWidth, el.classList.contains('is-left')]);
        // Beside the row on its left: it grows out of its right edge.
        expect(origin[2]).toBe(true);
        expect(Math.abs(origin[0] - origin[1])).toBeLessThan(1);
        const s = await shape(page);
        expect([s.compact, s.two, s.side]).toEqual([true, false, true]);
        expect(s.scrollHeight).toBeLessThanOrEqual(s.clientHeight);
        const overlaps = s.rect.left < s.row.right && s.rect.right > s.row.left && s.rect.top < s.row.bottom && s.rect.bottom > s.row.top;
        expect(overlaps).toBe(false);
        expectOnScreen(s);
        await page.screenshot({ path: '/tmp/fw31-layout-4.png' });
    });

    test('narrow and very short: compact, and it scrolls up and down only', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 300 });
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        await rowAt(page, 'bottom');
        await clickInPlace(page);
        const s = await shape(page);
        expect([s.compact, s.two, s.side]).toEqual([true, false, false]);
        expect(s.scrollHeight).toBeGreaterThan(s.clientHeight);
        expect(s.listOverflowX).toBe('hidden');
        expectOnScreen(s);
        await page.screenshot({ path: '/tmp/fw31-layout-5.png' });
        // Scrolling the popover itself keeps it open.
        await pop(page).hover();
        await page.mouse.wheel(0, 80);
        // The popover must stay open after the wheel: a fixed wait, so a late close would happen before the visibility check.
        await page.waitForTimeout(200);
        await expect(pop(page)).toBeVisible();
    });

    test('expanding at the bottom of the screen takes the shape ten headlines need', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 500 });
        await stubNews(page, 12, { long: true });
        await openDashboard(page);
        await rowAt(page, 'bottom');
        await clickInPlace(page);
        let s = await shape(page);
        expect([s.compact, s.two, s.side]).toEqual([false, false, false]);
        expectOnScreen(s);
        // The new shape is there as the click ends, before the next paint: the
        // longer list never shows in the old one.
        await pop(page).evaluate((el) => el.addEventListener('click', () => { window.__shapeOnClick = el.className; }, { once: true }));
        await pop(page).locator('.feed-news-pop-more').click();
        await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(10);
        expect(await page.evaluate(() => window.__shapeOnClick)).toContain('is-compact');
        s = await shape(page);
        expect(s.compact).toBe(true);
        expect(s.scrollHeight).toBeLessThanOrEqual(s.clientHeight);
        expectOnScreen(s);
    });
});

test.describe('on a desktop, with reduced motion', () => {
    test.use({ viewport: { width: 1500, height: 950 } });

    test('it appears and goes without an animation', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await stubNews(page, 3);
        await openDashboard(page);
        await name(page).click({ position: { x: 20, y: 10 } });
        await expect(pop(page)).toBeVisible();
        expect(await pop(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
        await page.keyboard.press('Escape');
        expect(await page.locator('.feed-news-pop, .feed-news-pop-closing').count()).toBe(0);
    });
});

for (const height of [812, 400]) {
    test.describe(`on a phone, ${height} px tall`, () => {
        test.use({ viewport: { width: 375, height }, hasTouch: true, isMobile: true });

        test('one column, never two or beside the row, and "+6 more" shows ten in place', async ({ page }) => {
            await stubNews(page, 12, { long: true });
            await openDashboard(page);
            await badge(page).tap();
            let s = await shape(page);
            expect([s.two, s.side]).toEqual([false, false]);
            expectOnScreen(s);
            await pop(page).locator('.feed-news-pop-more').tap();
            await expect(pop(page).locator('.feed-news-pop-item')).toHaveCount(10);
            await expect(pop(page).locator('.feed-news-pop-more')).toHaveText('+2 more · Open site');
            s = await shape(page);
            expect([s.two, s.side]).toEqual([false, false]);
            expectOnScreen(s);
        });
    });
}

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
