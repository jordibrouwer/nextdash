// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, keyOf, watchPayload, newsItem, headers } = require('./helpers/feed-watch');

/**
 * The news window wears the active theme: its stuck header is the panel's own
 * colour, everything that marks the news is the theme's accent, the footer's
 * buttons are one set, and nothing in it scrolls sideways. Only the newspaper
 * view keeps a paper look of its own.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async ({ request }) => {
    await site.close();
    await request.post('/api/settings', { data: { feedWatchNewsView: 'paper', theme: 'tidal-slate-dark' }, headers });
});

const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');

/** Open the news (the window's own, so the time bar shows) in a given view. */
async function openNews(page, request, { view, theme = 'tidal-slate-dark', width = 1440, height = 900 }) {
    expect((await request.post('/api/settings', { data: { theme, feedWatchNewsView: view }, headers })).ok()).toBe(true);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const longLead = '<p>Lead text with <a href="http://127.0.0.1:1/x">a link</a> and a_very_long_unbroken_word_that_could_push_things_sideways_in_a_narrow_window_if_it_did_not_wrap.</p>';
    const items = [1, 2, 3].map((n) => ({ ...newsItem(n, { summary: longLead.repeat(n === 1 ? 14 : 1) }), bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts' }));
    const recent = Array.from({ length: 4 }, (_, i) => ({
        id: `old${i}`, title: `Earlier entry ${i + 1}`, link: `http://127.0.0.1:1/old${i}`, summary: '<p>Older</p>',
        publishedAt: Date.now() - (i + 5) * 86_400_000, bookmarkKey: key, bookmarkName: 'Stub Blog', bookmarkUrl: site.url, feedTitle: 'Stub Posts',
    }));
    await page.route('**/api/feeds/watch', (route) => (route.request().method() !== 'GET' ? route.continue() : route.fulfill({
        contentType: 'application/json', body: JSON.stringify(watchPayload(key, items)),
    })));
    await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, recent }) }));
    await openDashboard(page);
    await page.evaluate(() => window.FeedWatchNews.open({}));
    await expect(modal(page)).toBeVisible();
}

/**
 * Everything that is wider than its scroller: the panel, its body (the news's
 * scroller, even where it clips sideways) and any other element that can
 * scroll. A clipped headline with an ellipsis is not a scroller.
 */
function sidewaysScrollers(page) {
    return modal(page).evaluate((root) => [root, ...root.querySelectorAll('*')]
        .filter((el) => el === root || el.classList.contains('modal-body') || ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
        .filter((el) => el.scrollWidth > el.clientWidth)
        .map((el) => `${el.className} ${el.scrollWidth}>${el.clientWidth}`));
}

test('nothing in the news window scrolls sideways, on a phone or a desktop, in every view', async ({ page, request }) => {
    test.setTimeout(120_000);
    for (const width of [390, 1440]) {
        for (const view of ['paper', 'wide', 'single']) {
            await openNews(page, request, { view, width, height: width < 500 ? 844 : 900 });
            // The newspaper opens on its front page, the others on an article.
            if (view === 'paper') {
                expect(await sidewaysScrollers(page), `${view} front page at ${width}px`).toEqual([]);
                await modal(page).locator('.feed-news-entry').first().click();
            }
            await expect(modal(page).locator('.feed-news-title')).toBeVisible();
            expect(await sidewaysScrollers(page), `${view} article at ${width}px`).toEqual([]);
            if (view === 'wide') {
                await modal(page).locator('[data-feed-news-index]').click();
                await expect(modal(page).locator('.feed-news-entry').first()).toBeVisible();
                expect(await sidewaysScrollers(page), `${view} index at ${width}px`).toEqual([]);
            }
            await page.keyboard.press('Escape');
            await expect(modal(page)).toBeHidden();
        }
    }
});

test('outside the newspaper the window takes the theme: the panel colour on top, the accent for the news', async ({ page, request }) => {
    test.setTimeout(90_000);
    const seen = {};
    for (const theme of ['tidal-slate-dark', 'tidal-slate-light']) {
        await openNews(page, request, { view: 'wide', theme });
        await expect(modal(page).locator('.feed-news-bar')).toBeVisible();
        seen[theme] = await modal(page).evaluate((panel) => {
            const resolve = (value) => {
                const probe = document.createElement('i');
                probe.style.color = value;
                document.body.appendChild(probe);
                const out = getComputedStyle(probe).color;
                probe.remove();
                return out;
            };
            const style = (sel) => getComputedStyle(panel.querySelector(sel));
            return {
                accent: resolve(getComputedStyle(document.body).getPropertyValue('--accent-primary').trim()),
                panel: getComputedStyle(panel).backgroundColor,
                atRest: style('.feed-news-top').backgroundColor,
                chip: style('.feed-news-chip').color,
                bar: style('.feed-news-bar > i').backgroundColor,
                open: style('[data-feed-news-open]').color,
                buttonBorder: style('[data-feed-news-step="1"]').borderTopColor,
            };
        });
        const look = seen[theme];
        // At rest the stuck top has no colour of its own: it is the panel itself.
        expect(look.atRest, `${theme}: header band at rest`).toBe('rgba(0, 0, 0, 0)');
        // With the news under it, it takes the panel's own colour, not a darker band of the page colour.
        await modal(page).locator('.modal-body').evaluate((el) => { el.scrollTop = 200; });
        await expect.poll(() => modal(page).evaluate((panel) => panel.querySelector('.feed-news-top').classList.contains('is-stuck'))).toBe(true);
        look.top = await modal(page).locator('.feed-news-top').evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(look.top, `${theme}: header band over the news`).toBe(look.panel);
        // What marks the news is the theme's accent, not a fixed purple.
        expect(look.chip, `${theme}: chip`).toBe(look.accent);
        expect(look.bar, `${theme}: time bar`).toBe(look.accent);
        expect(look.open, `${theme}: Open page`).toBe(look.accent);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toBeHidden();
    }
    const [dark, light] = [seen['tidal-slate-dark'], seen['tidal-slate-light']];
    expect(dark.top).not.toBe(light.top);
    expect(dark.buttonBorder).not.toBe(light.buttonBorder);
    expect(dark.chip).not.toBe(light.chip);
});

test('the footer buttons are one set: the same height, corner and border, in the app look and the newspaper', async ({ page, request }) => {
    for (const view of ['wide', 'paper']) {
        await openNews(page, request, { view });
        if (view === 'paper') await modal(page).locator('.feed-news-entry').first().click();
        const buttons = modal(page).locator('.feed-news-foot .modal-button');
        // Index, previous, next, Mark read and Open page.
        await expect(buttons).toHaveCount(5);
        const metrics = await buttons.evaluateAll((els) => els.map((el) => {
            const s = getComputedStyle(el);
            return { h: Math.round(el.getBoundingClientRect().height), r: s.borderTopLeftRadius, b: s.borderTopWidth, style: s.borderTopStyle };
        }));
        for (const m of metrics) expect(m, `${view}: ${JSON.stringify(metrics)}`).toEqual(metrics[0]);
        expect(metrics[0].style).toBe('solid');
        // The keys are chips in one row with the buttons, never under each other.
        const keys = await modal(page).locator('.feed-news-keys kbd').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
        expect(new Set(keys).size).toBe(1);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toBeHidden();
    }
});
