// @ts-check
/*
 * nextdash.cc, the notifications bell page: shot-1 (the bell open, with a Watch
 * feeds row and the age of each row) and shot-2 (scrolled to the tips). Full
 * 1440x900 frames over the manual's public seed.
 *
 *   MANUAL_SHOTS=1 SHOTS_OUT=/tmp/site-bell NEXTDASH_DATA_DIR=<seed copy> PW_WORKERS=1 \
 *     npx playwright test tests/site-shots-bell.spec.js
 */
const { test, prepare, shot, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'site pictures run on purpose only');
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);


/** Three watched sites with news, as GET /api/feeds/watch answers. */
async function watchNews(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const sites = (d.allBookmarks || []).filter((b) => /^https?:/.test(b.url)).slice(0, 3);
        const now = Date.now();
        const titles = [['A new release is out', 'Release notes for the spring update'], ['Why the backup failed', 'A post-mortem, written the next morning'], ['Three things we changed', 'What moved in the dashboard this week']];
        const watches = {};
        sites.forEach((b, i) => {
            const items = [0, 1, 2].map((n) => ({
                id: `demo-${i}-${n}`, title: titles[(i + n) % 3][0], link: b.url, summary: `<p>${titles[(i + n) % 3][1]}</p>`,
                publishedAt: now - (n + 1) * 3600_000, foundAt: now - (n + 1) * 60_000,
            }));
            watches[window.BookmarkUrlUtils.canonicalBookmarkURLKey(b.url)] = {
                newCount: 3, newAt: now, newest: items[0], newItems: items,
                feeds: [{ feedUrl: `${b.url.replace(/\/$/, '')}/feed/`, title: b.name, intervalMinutes: 60, checkedAt: now }],
            };
        });
        window.__watchStub = { limit: 100, total: sites.length, watches };
    });
    await page.route('**/api/feeds/watch', (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        return page.evaluate(() => window.__watchStub).then((body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }));
    });
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));
}

async function openBellWithAges(page) {
    await page.evaluate(() => {
        try { localStorage.removeItem('nextdash-keyboard-tip-current'); localStorage.removeItem('nextdash-keyboard-tips-offered'); } catch { /* none */ }
        window.dashboardInstance.settings.enableSessionTips = true;
    });
    await page.evaluate(() => window.DashboardKeyboardTip?.tick?.());
    await page.evaluate(() => window.NotificationBell.refreshAll());
    // Give each row an age that reads like a real day: the first look stamped them all "now".
    await page.evaluate(() => {
        const all = JSON.parse(localStorage.getItem('nextdash-bell-since') || '{}');
        const ages = { 'feed-watch': 4 * 60_000, 'updated-notice': 5 * 3600_000 };
        const spread = [38 * 60_000, 3 * 3600_000, 26 * 3600_000, 2 * 86400_000, 4 * 86400_000];
        let n = 0;
        Object.keys(all).forEach((id) => { all[id].at = Date.now() - (ages[id] ?? spread[n++ % spread.length]); });
        localStorage.setItem('nextdash-bell-since', JSON.stringify(all));
    });
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await page.locator('.notification-bell-row').first().waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the panel finishes sliding in.
    await page.waitForTimeout(900);
}

test('bell shot-1 and shot-2', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await watchNews(page);
    await openBellWithAges(page);
    await shot(page, 'shot-1.jpg');
    await page.evaluate(() => { const b = document.querySelector('.notification-bell-body'); if (b) b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(400);
    await shot(page, 'shot-2.jpg');
});
