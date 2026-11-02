// The highlights of v1.24.0: following a site's feed from its bookmark, and the
// news window. The news comes from the stub of the manual's shots
// (tests/helpers/watch-news-mock.js): neutral sites on *.example, no internet.
// See tests/whats-new-media.spec.js.
const { WRITE_TOKEN } = require('../../e2e-helpers');
const { newsData, startNewsStub, watchSites, shiftFeedTimes, feedUrl, siteUrl } = require('../../helpers/watch-news-mock');

const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();

/** Five sites already watched with their news; `skip` is left for the reader to follow. */
async function withNews(page, server, onDone, skip) {
    const stub = await startNewsStub({ hold: skip });
    onDone(() => stub.close());
    await watchSites(server, stub, { skip });
    await shiftFeedTimes(page);
    return stub;
}

module.exports = {
    shots: [
        {
            slug: 'follow-feeds',
            kind: 'video',
            alt: 'Right-click a bookmark, choose Watch this feed, tick the feed, and its row shows the newest headline and a count while the preview card shows the article',
            viewport: { width: 1280, height: 800 },
            dataTweak: { run: newsData },
            keepPointer: true,
            // The News category's column and the preview card beside the row.
            // The window of the dialog sits in the middle of the page; it is part of the crop.
            target: (page) => [
                row(page, 'Northside Gazette').locator('xpath=ancestor::*[contains(@class,"category")][1]'),
                page.locator('.bookmark-preview-card').first(),
                { boundingBox: async () => ({ x: 400, y: 100, width: 500, height: 500 }) },
            ],
            async setup(page, { openDashboard, settle, server, onDone }) {
                const stub = await withNews(page, server, onDone, ['northside']);
                // The page of the site names its feed; the stub answers for the
                // example host, which has no page to read.
                await page.route(/\/api\/feeds\/watch\/candidates/, (route) => route.fulfill({
                    json: { feeds: [{ url: `${siteUrl('northside')}feed.xml`, title: 'Northside Gazette', watched: false }] },
                }));
                // Saving reaches the stub where the example host has nothing to answer.
                await page.route(/\/api\/feeds\/watch$/, (route) => {
                    if (route.request().method() !== 'POST') return route.fallback();
                    return route.continue({ postData: (route.request().postData() || '').replace(`${siteUrl('northside')}feed.xml`, feedUrl('northside')) });
                });
                onDone(() => {});
                page.__stub = stub;
                await openDashboard(page);
                await settle(page);
                await row(page, 'Northside Gazette').waitFor();
                // The row is put where the recording keeps it, so the page does not move during the click.
                await row(page, 'Northside Gazette').evaluate((el) => el.scrollIntoView({ block: 'center' }));
                page.__scrollY = await page.evaluate(() => window.scrollY);
                await page.mouse.move(640, 780);
                // Pacing for the capture, not a condition: the page settles before the recording starts.
                await page.waitForTimeout(800);
            },
            async act(page, { server }) {
                const link = row(page, 'Northside Gazette');
                await link.click({ button: 'right' });
                // Pacing for the capture, not a condition: the context menu is on screen long enough to be read.
                await page.waitForTimeout(700);
                await page.getByText('Watch this feed…').first().click();
                const tick = page.locator('[data-feed-watch-tick]').first();
                await tick.waitFor();
                // Pacing for the capture, not a condition: the viewer sees the dialog before the tick is set.
                await page.waitForTimeout(600);
                await tick.check();
                // Pacing for the capture, not a condition: the ticked state stays on screen before Save.
                await page.waitForTimeout(700);
                await page.locator('[data-feed-watch-save]').click();
                await page.locator('.feed-watch-modal').waitFor({ state: 'hidden' });
                // The page redraws the row; it stays where the reader had it.
                await page.evaluate((y) => window.scrollTo(0, y), page.__scrollY);
                // The site publishes after the reader started following it.
                await page.__stub.arm('northside');
                await fetch(`${server.baseURL}/api/feeds/watch/poll`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NextDash-Token': WRITE_TOKEN }, body: '{}',
                });
                // The page asks the server again when the reader comes back to the tab.
                await page.waitForTimeout(600);
                await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
                await page.locator('.bookmark-link', { hasText: 'Harbour footbridge' }).first().waitFor({ timeout: 20_000 });
                await page.evaluate((y) => window.scrollTo(0, y), page.__scrollY);
                // Pacing for the capture, not a condition: the redrawn row rests before the pointer moves onto it.
                await page.waitForTimeout(1_000);
                await link.hover();
                await page.locator('.bookmark-preview-card-news-page').first().waitFor({ state: 'visible' });
                // Pacing for the capture, not a condition: the hover card stays on screen at the end of the recording.
                await page.waitForTimeout(1_800);
            },
        },
        {
            slug: 'news-window',
            kind: 'image',
            alt: 'The news window as a newspaper: a lead article with its picture and a list of the other articles with their pictures beside it',
            viewport: { width: 1280, height: 800 },
            dataTweak: { run: newsData },
            target: (page) => page.locator('#app-modal.show .modal').first(),
            async setup(page, { openDashboard, settle, server, onDone }) {
                await withNews(page, server, onDone, []);
                await openDashboard(page);
                await settle(page);
                await page.keyboard.press('Shift+N');
                await page.locator('[data-feed-news]').waitFor({ state: 'visible' });
                // The Newspaper layout, opened on its first article: the lead picture and the paper's list of the rest.
                const view = page.locator('.feed-news-view[data-feed-news-view="paper"]').first();
                await view.click();
                await page.locator('.feed-news-view[aria-pressed="true"]').waitFor();
                await page.locator('.feed-news-entry').first().click();
                await page.locator('.feed-news-card').first().waitFor({ state: 'visible' });
                // Pacing for the capture, not a condition: the window finishes drawing its pictures.
                await page.waitForTimeout(1_500);
            },
        },
    ],
};
