// @ts-check
/*
 * The MANUAL.md screenshots of v1.32.0: the search panel answering a cron line
 * and helping to type one, and the title cleanup of the RSS widget and of a
 * watched feed. Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-32.spec.js
 *
 * The feed titles are invented ("ADV-2026-0418 [High] Security fixes for ..."),
 * served in place of the feed by a page route, so no real site is named; the
 * pattern is checked by the real server.
 */
const { test, prepare, settle, snap, crop, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');
const { newsData, startNewsStub, watchSites, shiftFeedTimes } = require('./helpers/watch-news-mock');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const TITLES = [
    'ADV-2026-0418 [High] Router firmware: fixes for remote access',
    'ADV-2026-0417 [Medium] Proxy server: cache poisoning fixed',
    'ADV-2026-0416 [Medium] Database: privilege escalation fixed',
    'ADV-2026-0415 [Low] Desktop client: update available',
    'ADV-2026-0414 [High] Mail server: two vulnerabilities fixed',
];

const panel = (page) => page.locator('#shortcut-search .search-container');

test('08 search answers a cron line', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('>');
    await panel(page).waitFor();
    await page.keyboard.type('cron 0 9 * * 1-5');
    await page.locator('#search-matches .search-match', { hasText: 'Monday to Friday' }).first().waitFor();
    // Pacing for the capture, not a condition: the row finishes wrapping before the frame is taken.
    await page.waitForTimeout(700);
    await crop(page, panel(page), '08-search-tools.jpg');
});

test('08 search helps to type a tool', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('>');
    await panel(page).waitFor();
    await page.keyboard.type('cron ');
    await page.locator('#search-matches .search-match', { hasText: 'cron 0 9 * * 1-5' }).first().waitFor();
    // Pacing for the capture, not a condition: the rows finish drawing before the frame is taken.
    await page.waitForTimeout(700);
    await crop(page, panel(page), '08-search-tools-help.jpg');
});

test('16 the RSS widget cleans up its titles', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/widgets/rss**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ fetchedAt: Date.now(), items: TITLES.map((title, i) => ({ title, link: `https://advisories.example.org/${i}`, source: 'Example Advisories' })) }),
    }));
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="widgets"]').click();
    // The same two steps as a reader: Add widget, then the RSS card.
    await page.locator('[data-widget-catalogue]').first().click();
    await page.getByRole('option', { name: 'RSS', exact: true }).click();
    await page.locator('[data-widget-add="rss"]').first().click();
    const field = page.locator('[data-trf]').first();
    await field.waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('[data-widget-setting="feedUrls"]').first().fill('https://advisories.example.org/feed.xml');
    await field.locator('[data-trf-suggest]').click();
    await field.locator('[data-trf-preview]').waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the preview settles after the server's answer.
    await page.waitForTimeout(900);
    await settle(page);
    // The title fields on their own, the rest of the panel left out.
    await crop(page, field, '16-rss-title-cleanup.jpg', 6);
});

test.describe('a watched feed', () => {
    test.use({ dataTweak: { run: newsData } });
    test('12 a feed cleans up its titles', async ({ page, server }) => {
        const stub = await startNewsStub();
        try {
            await watchSites(server, stub);
        } finally {
            await stub.close();
        }
        await prepare(page);
        await shiftFeedTimes(page);
        // Tall enough for the whole of the feed's settings above the key legend.
        await page.setViewportSize({ width: 1440, height: 1300 });
        await openDashboard(page);

        await page.locator('.config-link-anchor').click();
        await page.locator('[data-config-section="feed-watch"]').click();
        await page.locator('[data-fwm-toggle]').first().waitFor();
        // Under the shot's frozen clock the watch list announces a change on every tick, and an open row is repainted away within a
        // frame. Nothing here changes data, so the announcement is switched off for this picture and the row then stays open.
        await page.evaluate(() => {
            const dispatch = document.dispatchEvent.bind(document);
            document.dispatchEvent = (event) => (event.type === 'feedwatch:changed' ? true : dispatch(event));
        });
        // Pacing for the capture, not a condition: the list settles once its repaints are switched off, before the row is opened.
        await page.waitForTimeout(600);
        await page.locator('[data-fwm-toggle]').first().click();
        const field = page.locator('[data-fwm-detail] [data-trf]').first();
        await field.waitFor({ state: 'visible', timeout: 20_000 });
        // The block says which feed it is for; the feed's items are then served with invented titles.
        const feedUrl = await field.getAttribute('data-trf-feed');
        await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                items: TITLES.map((title, i) => ({ title, feedUrl, link: `https://advisories.example.org/${i}` })),
                recent: [],
            }),
        }));
        await field.locator('[data-trf-suggest]').click();
        await page.locator('[data-fwm-detail] [data-trf-preview]:not([hidden])').first().waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the preview settles after the server's answer.
        await page.waitForTimeout(900);
        await snap(page, page.locator('[data-fwm-detail]').first(), '12-watch-feeds-title-cleanup.jpg', { pad: 16 });
    });
});
