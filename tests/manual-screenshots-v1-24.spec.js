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
