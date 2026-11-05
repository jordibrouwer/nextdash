// @ts-check
/*
 * The MANUAL.md screenshots of what v1.24 changed: Watch feeds. The preview
 * card that leads with the news, the news window in its three looks, and
 * Config → Watch feeds with its statistics. Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-24.spec.js
 *
 * The news comes from six neutral sites whose feeds a small server on this
 * machine answers (tests/helpers/watch-news-mock.js): nothing leaves the
 * machine, and the pictures are generated.
 */
const {
    test,
    prepare,
    settle,
    shot,
    crop,
    snap,
    openDashboard,
    DESKTOP,
    PHONE,
} = require('./helpers/manual-shot-kit');
const { newsData, startNewsStub, watchSites, shiftFeedTimes } = require('./helpers/watch-news-mock');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce', dataTweak: { run: newsData } });
test.setTimeout(120_000);

/** The six sites watched, the news in, and a page that reads the shot's clock. */
async function withNews(page, server) {
    const stub = await startNewsStub();
    try {
        await watchSites(server, stub);
    } finally {
        await stub.close();
    }
    await prepare(page);
    await shiftFeedTimes(page);
}

const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();

/** The news window, opened with its key and shown in one of its looks. */
async function openNews(page, view) {
    await openDashboard(page);
    await page.keyboard.press('Shift+N');
    const root = page.locator('[data-feed-news]');
    await root.waitFor({ state: 'visible' });
    await page.locator(`.feed-news-view[data-feed-news-view="${view}"]`).click();
    await page.locator(`.feed-news-view[data-feed-news-view="${view}"][aria-pressed="true"]`).waitFor();
    // Pacing for the capture, not a condition: the window finishes drawing its pictures.
    await page.waitForTimeout(1_500);
    return page.locator('#app-modal.show .modal');
}

test('04 preview card with news', async ({ page, server }) => {
    await withNews(page, server);
    await openDashboard(page);
    await row(page, 'Northside Gazette').hover();
    const card = page.locator('.bookmark-preview-card').first();
    await card.waitFor({ state: 'visible' });
    await page.locator('.bookmark-preview-card-news-page').first().waitFor();
    // Pacing for the capture, not a condition: the headline's picture finishes loading.
    await page.waitForTimeout(1_500);
    await crop(page, card, '04-preview-card-news.jpg');
});

test('04 the bell with watched news and the age of each row', async ({ page, server }) => {
    await withNews(page, server);
    await openDashboard(page);
    await page.evaluate(() => {
        try { localStorage.removeItem('nextdash-keyboard-tip-current'); localStorage.removeItem('nextdash-keyboard-tips-offered'); } catch { /* none */ }
        window.dashboardInstance.settings.enableSessionTips = true;
    });
    await page.evaluate(() => window.DashboardKeyboardTip?.tick?.());
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));
    await page.evaluate(() => window.NotificationBell.refreshAll());
    // The first look stamped every row "now": give each an age that reads like a real day.
    await page.evaluate(() => {
        const all = JSON.parse(localStorage.getItem('nextdash-bell-since') || '{}');
        const ages = { 'feed-watch': 4 * 60_000 };
        const spread = [38 * 60_000, 3 * 3600_000, 26 * 3600_000, 2 * 86400_000, 4 * 86400_000];
        let n = 0;
        Object.keys(all).forEach((id) => { all[id].at = Date.now() - (ages[id] ?? spread[n++ % spread.length]); });
        localStorage.setItem('nextdash-bell-since', JSON.stringify(all));
    });
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await page.locator('.notification-bell-row[data-bell-id="feed-watch"]').waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the panel finishes sliding in.
    await page.waitForTimeout(900);
    await shot(page, '04-bell.jpg');
});

test('12 click popover on a row with news', async ({ page, server }) => {
    await withNews(page, server);
    await openDashboard(page);
    // A click on the row opens the headlines; the preview card steps aside.
    const link = row(page, 'Northside Gazette');
    await link.click({ modifiers: [] });
    const pop = page.locator('.feed-news-pop');
    await pop.waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the popover grows in and its picture loads.
    await page.waitForTimeout(1_200);
    await crop(page, [link, pop], '12-watch-feeds-popover.jpg', 20);
});

test.describe('on a phone', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
    test('12 tap popover on a row with news', async ({ page, server }) => {
        await withNews(page, server);
        await openDashboard(page);
        const link = row(page, 'Northside Gazette');
        await link.tap();
        const pop = page.locator('.feed-news-pop');
        await pop.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the popover grows in.
        await page.waitForTimeout(1_200);
        await crop(page, [link, pop], '12-watch-feeds-popover-phone.jpg', 16);
    });
});

test('12 news window, one article', async ({ page, server }) => {
    await withNews(page, server);
    const modal = await openNews(page, 'single');
    // One article per screen: the window opens on the newest.
    await page.locator('.feed-news-link').first().waitFor();
    // Pacing for the capture, not a condition: the article's picture finishes loading.
    await page.waitForTimeout(1_200);
    await snap(page, modal, '12-watch-feeds-news.jpg', { pad: 16 });
});

test('12 news window, two columns', async ({ page, server }) => {
    await withNews(page, server);
    const modal = await openNews(page, 'wide');
    await snap(page, modal, '12-watch-feeds-news-columns.jpg', { pad: 16 });
});

test('12 news window, newspaper', async ({ page, server }) => {
    await withNews(page, server);
    const modal = await openNews(page, 'paper');
    await snap(page, modal, '12-watch-feeds-paper.jpg', { pad: 16 });
});

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await settle(page);
}

test('12 config watch feeds', async ({ page, server }) => {
    await withNews(page, server);
    // Just tall enough for the list: the frame ends under its panel.
    await page.setViewportSize({ width: 1440, height: 806 });
    await openConfig(page, 'feed-watch');
    // Pacing for the capture, not a condition: the list finishes drawing its pictures.
    await page.waitForTimeout(1_800);
    await shot(page, '12-watch-feeds-config.jpg');
});

test('12 statistics watch feeds', async ({ page, server }) => {
    await withNews(page, server);
    // Tall enough for the charts and the per-feed table.
    await page.setViewportSize({ width: 1440, height: 1246 });
    await openConfig(page, 'stats');
    await page.getByRole('tab', { name: /Watch feeds/ }).last().click();
    // Pacing for the capture, not a condition: the charts finish drawing.
    await page.waitForTimeout(2_600);
    await shot(page, '12-watch-feeds-stats.jpg');
});
