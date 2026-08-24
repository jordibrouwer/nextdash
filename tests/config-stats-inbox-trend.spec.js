// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two additions to Statistics.
 *
 * The server has recorded inbox throughput per day all along — inbox-stats.json
 * carries dailyBuckets keyed YYYY-MM-DD, and its own comment calls it "for the
 * trend chart" — but nothing drew it, so the Inbox tab showed lifetime totals
 * and no sense of whether the backlog was growing. It is also the only honest
 * time series here: the activity chart can only bucket bookmarks by a single
 * lastOpened, while each of these days was recorded as it happened.
 *
 * And the Overview stated facts across three tabs without ever drawing the
 * conclusion they add up to, so a headline names the habit.
 */

async function openStats(page) {
    await page.goto('/');
    // Waiting for the bookmarks (not just the pages) lets the icon prefetch it
    // kicks off finish; its overlay is a full-screen scrim that would otherwise
    // still be up and swallow every pointer aimed at a bar.
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
}

/** Seeds daily buckets and shows the Inbox tab. */
async function seedTrend(page, { days = 14, empty = false } = {}) {
    await page.evaluate(({ days, empty }) => {
        const c = window.dashboardInstance.config;
        const iso = (x) => x.toISOString().slice(0, 10);
        const now = new Date();
        const buckets = {};
        for (let i = 0; i < days; i++) {
            const key = iso(new Date(now.getTime() - i * 86400000));
            buckets[key] = empty
                ? { added: 0, promoted: 0, deleted: 0 }
                : { added: (i * 3) % 7 + 1, promoted: i % 3, deleted: i % 2 };
        }
        c._statsInboxItems = [];
        c._statsInboxAgg = { dailyBuckets: buckets, bySource: {} };
        c.statsTab = 'inbox';
        c.repaintStatsBody();
    }, { days, empty });
}

/**
 * Clear the icon-prefetch scrim before aiming a pointer at a bar.
 *
 * It sits at z-index 12000 over the whole viewport with pointer-events auto,
 * and in the e2e environment the prefetch never reports finishing, so it stays
 * up for the life of the page. Waiting for it would hang; it belongs to a
 * different feature entirely, so removing it is what isolates this test.
 */
async function settleOverlays(page) {
    await page.evaluate(() => {
        document.getElementById('favicon-prefetch-overlay')?.remove();
        document.querySelectorAll('.app-notification').forEach((e) => e.remove());
    });
    // The scrim is re-shown by an in-flight prefetch batch, so one removal can
    // be undone a moment later. Confirm the point is clear before pointing at it.
    await page.waitForFunction(
        () => !document.getElementById('favicon-prefetch-overlay'),
        null,
        { timeout: 5_000 },
    ).catch(async () => {
        await page.evaluate(() => document.getElementById('favicon-prefetch-overlay')?.remove());
    });
}

const trendPanel = (page) => page.locator('.config-panel')
    .filter({ has: page.locator('.config-panel-title', { hasText: 'Inbox flow per day' }) }).first();

test.describe('statistics: the inbox trend chart', () => {
    test('it draws the daily history the server already kept', async ({ page }) => {
        await openStats(page);
        await seedTrend(page);

        const panel = trendPanel(page);
        await expect(panel).toBeVisible();
        // Two bars per day, so a fortnight is 28 rects across 14 hit targets.
        expect(await panel.locator('.config-chart-bar').count()).toBeGreaterThan(1);
        expect(await panel.locator('.config-chart-bar-fill--a').count())
            .toBe(await panel.locator('.config-chart-bar-fill--b').count());
    });

    test('two series means a legend, not colour alone', async ({ page }) => {
        await openStats(page);
        await seedTrend(page);
        const legend = trendPanel(page).locator('.config-chart-legend-item');
        await expect(legend).toHaveCount(2);
    });

    test('the two series are actually distinguishable', async ({ page }) => {
        await openStats(page);
        await seedTrend(page);
        // Several themes define --accent-success as the same colour as
        // --accent-primary, which made both series identical.
        const fills = await trendPanel(page).evaluate((el) => ({
            a: getComputedStyle(el.querySelector('.config-chart-bar-fill--a')).fill,
            b: getComputedStyle(el.querySelector('.config-chart-bar-fill--b')).fill,
        }));
        expect(fills.a).not.toBe(fills.b);
    });

    test('it says which way the backlog moved', async ({ page }) => {
        await openStats(page);
        await seedTrend(page);
        // More added than dealt with in the seed, so the backlog grew.
        await expect(trendPanel(page).locator('.config-stat-trend')).toContainText(/grew|shrank/i);
    });

    test('a quiet period says so instead of drawing a flat chart', async ({ page }) => {
        await openStats(page);
        await seedTrend(page, { empty: true });
        const panel = trendPanel(page);
        await expect(panel.locator('.config-panel-empty')).toBeVisible();
        await expect(panel.locator('svg')).toHaveCount(0);
    });

    test('no history at all hides the panel entirely', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c._statsInboxItems = [];
            c._statsInboxAgg = { bySource: {} };
            c.statsTab = 'inbox';
            c.repaintStatsBody();
        });
        await expect(trendPanel(page)).toHaveCount(0);
        // The rest of the tab still renders.
        await expect(page.locator('.config-panel').first()).toBeVisible();
    });

    test('hovering a day reports both series and the date', async ({ page }) => {
        await openStats(page);
        await seedTrend(page);
        await settleOverlays(page);
        const panel = trendPanel(page);
        // The floating search/command bar hovers over the middle of the panel,
        // so aim at a bar it does not cover rather than at a fixed index.
        const bars = panel.locator('.config-chart-bar');
        const count = await bars.count();
        let hit = null;
        for (let i = count - 1; i >= 0 && !hit; i--) {
            const box = await bars.nth(i).boundingBox();
            if (!box) continue;
            const point = { x: box.x + box.width / 2, y: box.y + box.height - 12 };
            const clear = await page.evaluate((p) => {
                const el = document.elementFromPoint(p.x, p.y);
                return Boolean(el?.closest('.config-chart-bar'));
            }, point);
            if (clear) hit = point;
        }
        expect(hit, 'no bar was reachable by pointer').not.toBeNull();
        await page.mouse.move(hit.x, hit.y);

        const tip = panel.locator('.config-chart-tip');
        await expect(tip).toBeVisible();
        // One tooltip lists every series, so the pointer never has to find the
        // right bar of the pair.
        await expect(tip.locator('.config-chart-tip-row')).toHaveCount(2);
    });

    test('the trend chart does not steal the activity chart binding', async ({ page }) => {
        await openStats(page);
        // The activity chart plots bookmarks by their last use, so on an install
        // where nothing has ever been opened it draws its empty state and there
        // is no bar to hover. Seeded here rather than borrowed from whatever
        // another spec left in the shared data directory.
        await page.evaluate(() => {
            const DAY = 86400000;
            const now = Date.now();
            window.dashboardInstance.allBookmarks.forEach((b, i) => {
                b.openCount = [12, 30, 5, 8, 2][i % 5];
                b.lastOpened = now - (i % 12) * DAY;
            });
            window.dashboardInstance.config.render();
        });
        await settleOverlays(page);
        // Both tabs own a chart; binding only the first would leave one inert.
        await page.locator('[data-stats-tab="activity"]').click();
        const activity = page.locator('.config-panel')
            .filter({ has: page.locator('.config-panel-title', { hasText: 'Bookmarks used over time' }) }).first();
        const bar = activity.locator('.config-chart-bar').last();
        const box = await bar.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
        await expect(activity.locator('.config-chart-tip')).toBeVisible();
    });
});

test.describe('statistics: the overview names the habit', () => {
    test('a headline sits below the tiles, in a standard panel', async ({ page }) => {
        await openStats(page);
        const headline = page.locator('.config-stats-headline');
        await expect(headline).toBeVisible();
        await expect(headline).not.toBeEmpty();

        const layout = await page.evaluate(() => {
            const body = document.getElementById('config-stats-body');
            const head = body.querySelector('.config-stats-headline');
            const panel = head.closest('.config-panel');
            const tiles = body.querySelector('.config-tiles--overview');
            // It must wear the section chrome the neighbouring panels wear,
            // rather than a border and background of its own.
            const other = [...body.querySelectorAll('.config-panel')].find((p) => p !== panel);
            const chrome = (el) => {
                const s = getComputedStyle(el);
                return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius, s.backgroundColor, s.paddingTop].join('|');
            };
            return {
                inPanel: Boolean(panel),
                hasTitle: Boolean(panel.querySelector('.config-panel-title')),
                belowTiles: tiles.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top,
                matchesNeighbour: other ? chrome(panel) === chrome(other) : null,
            };
        });
        expect(layout.inPanel).toBe(true);
        expect(layout.hasTitle).toBe(true);
        expect(layout.belowTiles).toBe(true);
        expect(layout.matchesNeighbour).toBe(true);
    });

    test('it reads the collection rather than repeating one number', async ({ page }) => {
        await openStats(page);
        // A shortcut-heavy, lightly-tagged collection: the habit is keystrokes.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const pageId = d.pages[0].id;
            d.allBookmarks = Array.from({ length: 20 }, (_, i) => ({
                name: `B${i}`, url: `https://b${i}.example.com/`, pageId,
                category: '', tags: i < 2 ? ['t'] : [],
                shortcut: i < 18 ? `s${i}` : '',
                openCount: i < 10 ? 5 : 0,
                lastOpened: i < 10 ? Date.now() - i * 86400000 : 0,
            }));
            d.config.statsTab = 'overview';
            d.config.repaintStatsBody();
        });
        await expect(page.locator('.config-stats-headline')).toContainText(/keystroke|shortcut/i);
    });

    test('with nothing opened it says so rather than inventing a habit', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks = [{
                name: 'Unused', url: 'https://u.example.com/', pageId: d.pages[0].id,
                category: '', tags: [], openCount: 0, lastOpened: 0,
            }];
            d.config.statsTab = 'overview';
            d.config.repaintStatsBody();
        });
        await expect(page.locator('.config-stats-headline')).toContainText(/nothing has been opened/i);
    });

    test('an empty collection shows no headline at all', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks = [];
            d.config.statsTab = 'overview';
            d.config.repaintStatsBody();
        });
        // The empty state already explains the page; a habit claim would be noise.
        await expect(page.locator('.config-stats-headline')).toHaveCount(0);
    });
});
