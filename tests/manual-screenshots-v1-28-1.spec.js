// @ts-check
/*
 * The MANUAL.md screenshots of the Jellystat, Bazarr and Prowlarr widgets
 * (v1.28.1), each two columns wide so every part shows side by side. Same
 * harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-28-1.spec.js
 *
 * The answers are mocked in the shape the server sends, with invented titles
 * and names: a real server would put real titles and indexers in the picture.
 */
const { test, prepare, snap, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });

const MINUTE = 60_000;

test.describe('the Jellystat, Bazarr and Prowlarr tiles', () => {
    // Three tiles two columns wide stand below one another: a tall window shows them all, so no scrolling decides what is in the picture.
    test.use({ dataPatch: 'arrtiles', viewport: { width: 1440, height: 2200 } });

    test('15 jellystat bazarr prowlarr', async ({ page }) => {
        await prepare(page);
        const now = Date.now();

        // Posters for the recent plays: plain generated artwork, no real titles.
        await page.route('**/api/widgets/jellystat/image**', (route) => route.fulfill({
            contentType: 'image/svg+xml',
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b6a8a"/><stop offset="1" stop-color="#d9a441"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="100" cy="110" r="46" fill="#ffffff" fill-opacity=".25"/></svg>`,
        }));

        const js = 'http://jellystat.local:3000';
        await page.route('**/api/widgets/jellystat?**', (route) => route.fulfill({ json: {
            fetchedAt: now, items: [], libraries: [],
            stats: {
                days: 30, topics: ['activity', 'items', 'users', 'totals'], openUrl: js,
                totals: { plays: 214, seconds: 61 * 3600 },
                activity: [
                    { id: 'a1', poster: '/api/widgets/jellystat/image?x=a1', title: 'Harbour Lights', subtitle: 'The Long Tide', who: 'sam', device: 'Living room', method: 'DirectPlay', seconds: 2700, at: now - 6 * MINUTE, openUrl: `${js}/libraries/item/a1` },
                    { id: 'a2', poster: '/api/widgets/jellystat/image?x=a2', title: 'Copper Fields', who: 'ida', device: 'Phone', method: 'Transcode', seconds: 5400, at: now - 3 * 60 * MINUTE, openUrl: `${js}/libraries/item/a2` },
                    { id: 'a3', poster: '/api/widgets/jellystat/image?x=a3', title: 'Harbour Lights', subtitle: 'Ebb', who: 'sam', device: 'Living room', method: 'DirectPlay', seconds: 2640, at: now - 26 * 60 * MINUTE, openUrl: `${js}/libraries/item/a3` },
                    { id: 'a4', poster: '/api/widgets/jellystat/image?x=a4', title: 'The Quiet Orchard', who: 'noor', device: 'Tablet', method: 'DirectPlay', seconds: 6000, at: now - 50 * 60 * MINUTE, openUrl: `${js}/libraries/item/a4` },
                ],
                items: [
                    { id: 'i1', title: 'Harbour Lights', kind: 'series', plays: 19, seconds: 51000, openUrl: `${js}/libraries/item/i1` },
                    { id: 'i2', title: 'Copper Fields', kind: 'movie', plays: 8, seconds: 43000, openUrl: `${js}/libraries/item/i2` },
                    { id: 'i3', title: 'Night Ferry', kind: 'series', plays: 6, seconds: 14000, openUrl: `${js}/libraries/item/i3` },
                    { id: 'i4', title: 'The Quiet Orchard', kind: 'movie', plays: 4, seconds: 24000, openUrl: `${js}/libraries/item/i4` },
                ],
                users: [
                    { id: 'u1', name: 'sam', plays: 96, openUrl: `${js}/users/u1` },
                    { id: 'u2', name: 'ida', plays: 61, openUrl: `${js}/users/u2` },
                    { id: 'u3', name: 'noor', plays: 38, openUrl: `${js}/users/u3` },
                    { id: 'u4', name: 'guest', plays: 9, openUrl: `${js}/users/u4` },
                ],
            },
        } }));

        const bz = 'http://bazarr.local:6767';
        await page.route('**/api/widgets/bazarr?**', (route) => route.fulfill({ json: {
            fetchedAt: now, items: [], libraries: [],
            subs: {
                topics: ['missing', 'recent', 'totals'], openUrl: bz,
                totals: { missingMovies: 18, missingEpisodes: 3, providerIssues: 0 },
                missing: [
                    { id: 'm1', kind: 'movie', title: 'Copper Fields', languages: ['nl'], openUrl: `${bz}/movies/1` },
                    { id: 'e1', kind: 'episode', title: 'Night Ferry', subtitle: '2x4 The Last Crossing', languages: ['nl', 'en+hi'], openUrl: `${bz}/series/9` },
                    { id: 'm2', kind: 'movie', title: 'The Quiet Orchard', languages: ['nl'], openUrl: `${bz}/movies/2` },
                    { id: 'e2', kind: 'episode', title: 'Harbour Lights', subtitle: '1x7 Slack Water', languages: ['en'], openUrl: `${bz}/series/8` },
                ],
                recent: [
                    { id: 'r1', kind: 'movie', title: 'Saltmarsh', language: 'nl', provider: 'opensubtitlescom', score: '90.56%', at: now - 12 * MINUTE, openUrl: `${bz}/movies/3` },
                    { id: 'r2', kind: 'episode', title: 'Night Ferry', subtitle: '2x3 Fog Signal', language: 'nl+hi', provider: 'subf2m', score: '99.72%', upgrade: true, at: now - 2 * 60 * MINUTE, openUrl: `${bz}/series/9` },
                    { id: 'r3', kind: 'movie', title: 'Glass Harbour', language: 'en', provider: 'opensubtitlescom', score: '84.10%', at: now - 9 * 60 * MINUTE, openUrl: `${bz}/movies/4` },
                    { id: 'r4', kind: 'episode', title: 'Harbour Lights', subtitle: '1x6 Spring Tide', language: 'nl', provider: 'subf2m', score: '88.00%', at: now - 20 * 60 * MINUTE, openUrl: `${bz}/series/8` },
                ],
            },
        } }));

        const pr = 'http://prowlarr.local:9696';
        await page.route('**/api/widgets/prowlarr?**', (route) => route.fulfill({ json: {
            fetchedAt: now, items: [], libraries: [],
            indexers: {
                days: 7, topics: ['indexers', 'issues', 'totals'], openUrl: pr,
                totals: { enabled: 5, total: 7, queries: 8822, grabs: 141, failed: 8 },
                indexers: [
                    { id: 5, name: 'Meridian NZB', protocol: 'usenet', queries: 2098, grabs: 0, failed: 0, avgMs: 4526, paused: true, openUrl: `${pr}/indexers` },
                    { id: 1, name: 'Northgate', protocol: 'usenet', queries: 2139, grabs: 75, failed: 0, avgMs: 400, openUrl: `${pr}/indexers` },
                    { id: 2, name: 'Fjord Tracker', protocol: 'torrent', queries: 2130, grabs: 16, failed: 0, avgMs: 179, openUrl: `${pr}/indexers` },
                    { id: 3, name: 'Lantern NZB', protocol: 'usenet', queries: 2120, grabs: 5, failed: 7, avgMs: 315, openUrl: `${pr}/indexers` },
                ],
                issues: [
                    { id: 'p5', level: 'error', text: 'Meridian NZB', until: now + 4 * 60 * MINUTE, openUrl: `${pr}/indexers` },
                    { id: 'h0', level: 'warning', text: 'Applications are unavailable due to failures for more than 6 hours: Bookshelf', openUrl: `${pr}/system/status` },
                ],
            },
        } }));

        await openDashboard(page, '#4');
        const tile = (type) => page.locator(`[data-widget-type="${type}"]`).first();
        for (const type of ['jellystat', 'bazarr', 'prowlarr']) await tile(type).waitFor();
        await page.waitForTimeout(800);
        // One tile at a time.
        for (const [type, name] of [['jellystat', '15-jellystat.jpg'], ['bazarr', '15-bazarr.jpg'], ['prowlarr', '15-prowlarr.jpg']]) {
            await snap(page, tile(type), name, { pad: 10 });
        }
    });
});

test('16 the widget picker with the media kinds', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // The address the picker has: the same one the Config → Widgets button opens.
    await page.goto('/#config/widgets/catalogue');
    const picker = page.locator('.modal--widget-catalogue');
    await picker.waitFor();
    // The Media group, with Bazarr chosen so the pane beside the list shows it.
    const option = picker.locator('[data-widget-option="bazarr"]').first();
    await option.scrollIntoViewIfNeeded();
    await option.click();
    // Pacing for the capture, not a condition: the pane beside the list redraws.
    await page.waitForTimeout(600);
    await snap(page, picker, '16-widget-picker.jpg', { pad: 0 });
});
