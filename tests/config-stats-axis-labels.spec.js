// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Axis labels on the Statistics charts.
 *
 * Every panel drew a name, a bar and a number with nothing saying what the
 * number counted. These assert the labels exist and, more importantly, that
 * they say the right thing: the activity chart's x-axis names the bucket the
 * selected range actually uses, and each list header names its own measure
 * rather than a single hardcoded word.
 */

async function openStats(page) {
    // Before navigating, not after: dismissBlockingOverlays only closes a modal
    // that is already up. The what's-new prompt decides to open, then fetches
    // its module -- so on a release whose cache token has just moved, the fetch
    // is a miss and the modal lands well after the dismissal, over the config
    // view, where it swallows the hover this file is built on.
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // The config intro tip -- "In config: j/k move sections..." -- shows for
        // fourteen seconds the first time config opens, in the bottom-right
        // corner, which is where the activity chart's last bars are. It arrives
        // after dismissBlockingOverlays has been and gone, so the only way past
        // it is not to raise it. Three other config specs mark it the same way.
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        const DAY = 86400000;
        const now = Date.now();
        window.dashboardInstance.allBookmarks.forEach((b, i) => {
            b.openCount = [12, 30, 5, 0, 8, 2, 19][i % 7];
            b.lastOpened = b.openCount ? now - (i % 25) * DAY : 0;
        });
        window.dashboardInstance.config.openConfigView('stats');
    });
    await expect(page.locator('.config-tiles')).toBeVisible();
}

async function openStatsTab(page, tab) {
    await openStats(page);
    await page.locator(`[data-stats-tab="${tab}"]`).click();
    await expect(page.locator('#config-stats-body .config-panel').first()).toBeVisible();
}

const panelByTitle = (page, title) =>
    page.locator('.config-panel').filter({ has: page.locator('.config-panel-title', { hasText: title }) }).first();

/** The live activity chart's uPlot instance, read in the page. */
const ACTIVITY_PLOT = `window.dashboardInstance.config._statsColumnCharts
    .map((c) => c.plot).find((p) => document.contains(p.root) && p.root.closest('#config-stats-opens'))`;

async function yScale(page) {
    return page.evaluate((expr) => {
        const plot = eval(expr);
        return { min: plot.scales.y.min, max: plot.scales.y.max };
    }, ACTIVITY_PLOT);
}

/** Each x tick as drawn: its label, and where it starts and ends on the canvas. */
async function xTicks(page) {
    return page.evaluate((expr) => {
        const plot = eval(expr);
        const axis = plot.axes[0];
        const left = plot.bbox.left / (window.uPlot.pxRatio || devicePixelRatio);
        return axis._splits.map((v, i) => {
            const label = axis._values[i] || '';
            const at = left + plot.valToPos(v, 'x');
            const half = (label.length * 6.6) / 2;
            return { label, left: at - half, right: at + half, canvas: plot.width };
        });
    }, ACTIVITY_PLOT);
}

test.describe('statistics: what the activity chart counts', () => {
    /**
     * A bookmark holds a cumulative openCount and one lastOpened, with no
     * per-open history. The chart used to add the whole openCount to the bucket
     * of lastOpened, so a lifetime of use landed on a single day: 100 opens
     * gathered over a year drew a bar of 100 on the Tuesday it was last
     * touched. Each bookmark now counts once, which is what the data supports.
     */
    async function seedAndCompute(page, seed) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
            // Returned, not just called: openConfigView is awaited here, and
            // dropping that is what left computeActivity with no buckets.
            return window.dashboardInstance.config.openConfigView('stats');
        });
        await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
        return page.evaluate((rows) => {
            const d = window.dashboardInstance, c = d.config;
            const now = Date.now();
            d.allBookmarks.forEach((b) => { b.openCount = 0; b.lastOpened = 0; });
            rows.forEach((r, i) => {
                if (!d.allBookmarks[i]) return;
                d.allBookmarks[i].openCount = r.opens;
                d.allBookmarks[i].lastOpened = now - r.daysAgo * 86400000;
            });
            c.statsRange = 30;
            const a = c.computeActivity(d.allBookmarks);
            return {
                buckets: a.buckets,
                max: Math.max(...a.buckets),
                sum: a.buckets.reduce((s, v) => s + v, 0),
                activeCount: a.activeCount,
                totalOpens: a.totalOpens,
            };
        }, seed);
    }

    test('a heavily used bookmark does not spike one day', async ({ page }) => {
        const r = await seedAndCompute(page, [
            { opens: 100, daysAgo: 3 },
            { opens: 1, daysAgo: 1 },
        ]);
        // The old code produced a bar of 100 here.
        expect(r.max).toBe(1);
        expect(r.sum).toBe(2);
    });

    test('the bars count bookmarks, so they sum to the bookmarks used', async ({ page }) => {
        const r = await seedAndCompute(page, [
            { opens: 40, daysAgo: 2 },
            { opens: 7, daysAgo: 2 },
            { opens: 3, daysAgo: 9 },
        ]);
        // Two on the same day must stack — the bar is a count, not a maximum.
        expect(r.sum).toBe(3);
        expect(r.sum).toBe(r.activeCount);
        expect(r.max).toBe(2);
    });

    test('the all-time opens figure still reports real opens', async ({ page }) => {
        const r = await seedAndCompute(page, [
            { opens: 100, daysAgo: 3 },
            { opens: 1, daysAgo: 1 },
        ]);
        // Dropping openCount from the bars must not lose the true total; it
        // moves to its own headline rather than disappearing.
        expect(r.totalOpens).toBe(101);
    });

    test('the panel says what a bar means, and the title matches', async ({ page }) => {
        // Through openStatsTab, which seeds opens: with nothing ever opened the
        // panel draws its empty state instead, and has no note to read. It
        // passed only while another spec had left opens behind in the shared
        // data directory — which is not a thing to depend on.
        await openStatsTab(page, 'usage');

        // Until openLog reaches back two weeks, the chart is the last-used
        // one, and its (i) says what a bar counts.
        const panel = page.locator('#config-stats-opens');
        await expect(panel.locator('.config-panel-title')).toHaveText(/used over time/i);
        await expect(panel.locator('.config-stats-info')).toHaveAttribute('aria-label', /last use/i);
    });
});

test.describe('statistics: chart axis labels', () => {
    test('the activity chart names both axes', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const panel = panelByTitle(page, 'Bookmarks used over time');

        // y: what the bars count, plus a real top tick rather than an unlabelled
        // scale. The bars count bookmarks, not opens — the axis must say so.
        await expect(panel.locator('.config-chart-axis-title')).toHaveText(/bookmarks/i);
        // The value axis is uPlot's: from 0 to above the tallest bar.
        await expect(panel.locator('.nd-chart canvas')).toBeVisible();
        const y = await yScale(page);
        expect(y.min).toBe(0);
        expect(y.max).toBeGreaterThan(0);

        // x: what one bar covers.
        await expect(panel.locator('.config-chart-axis-x')).toBeVisible();
    });

    test('the x-axis label follows the selected range', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        const axis = panel.locator('.config-chart-axis-x');

        // computeActivity() buckets by day / week / month depending on range, so
        // a fixed "Date" would be wrong on two of the three.
        await panel.locator('[data-stats-range="7"]').click();
        await expect(axis).toHaveText(/day/i);

        await panelByTitle(page, 'Bookmarks used over time').locator('[data-stats-range="90"]').click();
        await expect(panelByTitle(page, 'Bookmarks used over time').locator('.config-chart-axis-x')).toHaveText(/week/i);

        await panelByTitle(page, 'Bookmarks used over time').locator('[data-stats-range="365"]').click();
        await expect(panelByTitle(page, 'Bookmarks used over time').locator('.config-chart-axis-x')).toHaveText(/month/i);
    });

    test('the ranked lists name their own measure, not a shared one', async ({ page }) => {
        await openStatsTab(page, 'usage');

        // Both come from one helper; the measure differs and must not be shared.
        const opened = panelByTitle(page, 'Most opened').locator('.config-dist-axis');
        const tags = panelByTitle(page, 'Most used tags').locator('.config-dist-axis');
        if (await opened.count()) {
            await expect(opened.locator('.config-dist-axis-label')).toHaveText(/bookmark/i);
            await expect(opened.locator('.config-dist-axis-value')).toHaveText(/opens/i);
        }
        await expect(tags.locator('.config-dist-axis-label')).toHaveText(/tag/i);
        await expect(tags.locator('.config-dist-axis-value')).toHaveText(/bookmarks/i);
    });

    test('the distribution panels label their columns', async ({ page }) => {
        await openStatsTab(page, 'collection');

        const perPage = panelByTitle(page, 'Bookmarks per page').locator('.config-dist-axis');
        await expect(perPage.locator('.config-dist-axis-label')).toHaveText(/page/i);
        await expect(perPage.locator('.config-dist-axis-value')).toHaveText(/bookmarks/i);

        const perCat = panelByTitle(page, 'Categories: size and use').locator('.config-stats-pair-head');
        await expect(perCat).toContainText(/category/i);
        await expect(perCat).toContainText(/opens per bookmark/i);
    });

    test('the coverage bars state the scale they share', async ({ page }) => {
        await openStatsTab(page, 'collection');
        const caption = panelByTitle(page, 'Coverage').locator('.config-chart-scale');
        await expect(caption).toBeVisible();
        // Names the denominator and the range, so a bar is not just "some width".
        await expect(caption).toHaveText(/0%\s*to\s*100%/i);
    });

    test('every axis caption is hidden from screen readers', async ({ page }) => {
        await openStatsTab(page, 'collection');
        // The panels already carry aria-labels and an sr-only table; the visual
        // captions would only duplicate that.
        const captions = page.locator('.config-chart-scale, .config-dist-axis, .config-chart-axis-x, .config-chart-axis-y');
        const n = await captions.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
            await expect(captions.nth(i)).toHaveAttribute('aria-hidden', 'true');
        }
    });

    test('the plot is tall enough to compare neighbouring bars', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const canvas = panelByTitle(page, 'Bookmarks used over time').locator('.nd-chart canvas');
        await expect(canvas).toBeVisible();
        const box = await canvas.boundingBox();
        // 72px was too short for a day-to-day comparison; 108 is that plus half.
        expect(box.height).toBeGreaterThanOrEqual(100);
    });

    test('the x-axis carries dated ticks, not just its two ends', async ({ page }) => {
        await openStatsTab(page, 'usage');
        await expect(panelByTitle(page, 'Bookmarks used over time').locator('.nd-chart canvas')).toBeVisible();
        const ticks = (await xTicks(page)).filter((t) => t.label);
        expect(ticks.length).toBeGreaterThan(2);
        // Spaced by the widest label, so 30 bars do not smear into each other.
        expect(ticks.length).toBeLessThanOrEqual(10);
        // Real dates, not "12d ago".
        expect(ticks[0].label).not.toMatch(/ago/i);
    });

    test('no tick escapes the plot or collides, at any range', async ({ page }) => {
        await openStatsTab(page, 'usage');

        // The wide weekly labels ("Jul 29 – Aug 4") overflowed the panel and ran
        // into each other: the end ticks were centred on their bar, so half the
        // text sat outside, and six of them did not fit at that width.
        for (const range of ['7', '30', '90', '365']) {
            const panel = panelByTitle(page, 'Bookmarks used over time');
            await panel.locator(`[data-stats-range="${range}"]`).click();
            await expect(page.locator(`[data-stats-range="${range}"]`)).toHaveAttribute('aria-pressed', 'true');
            await expect(panelByTitle(page, 'Bookmarks used over time').locator('.nd-chart canvas')).toBeVisible();

            // uPlot draws the labels on the canvas; their place and width are
            // worked out from the plot (11px monospace, 6.6px a character).
            const ticks = (await xTicks(page)).filter((t) => t.label);
            const outside = ticks.filter((t) => t.left < -1 || t.right > t.canvas + 1).map((t) => t.label);
            let collide = 0;
            for (let i = 1; i < ticks.length; i++) if (ticks[i - 1].right + 4 > ticks[i].left) collide++;
            const geo = { outside, collide, count: ticks.length };

            expect(geo.outside, `${range}d: ticks outside the plot`).toEqual([]);
            expect(geo.collide, `${range}d: ticks touching`).toBe(0);
            expect(geo.count).toBeGreaterThan(1);
        }
    });

    test('hovering a bar shows its value and its date', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        const over = panel.locator('.nd-chart .u-over');
        const tip = panel.locator('.nd-chart-tip');
        // Clicking the tab left the pointer inside the panel, which may already
        // be over a bar — park it somewhere neutral before asserting the
        // resting state.
        await page.mouse.move(2, 2);
        await expect(tip).toBeHidden();

        // hover() rather than a raw mouse.move: it re-checks that the plot is
        // what the pointer lands on, and waits if something is over it.
        const box = await over.boundingBox();
        await over.hover({ position: { x: box.width - 4, y: box.height / 2 } });
        await expect(tip).toBeVisible();
        // The date, then the value.
        await expect(tip).toHaveText(/\S.* · \d+/);

        // Leaving the chart clears it.
        await page.mouse.move(box.x + box.width / 2, box.y - 200);
        await expect(tip).toBeHidden();
    });

    test('the same values are reachable by keyboard, not hover only', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        const chart = panel.locator('.nd-chart');

        await chart.focus();
        await page.keyboard.press('Home');
        await expect(chart.locator('.nd-chart-readout')).toHaveText(/ · \d+/);
        await page.keyboard.press('ArrowRight');
        await expect(chart.locator('.nd-chart-tip')).toBeVisible();
        // And to a screen reader, which never gets a pointer at all.
        await expect(chart).toHaveAttribute('aria-label', /\S/);
        await expect(chart.locator('table.nd-chart-table tbody tr').first()).toHaveText(/\d+/);
    });

    test('the bar hit target is bigger than the painted bar', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        // A one-open day paints a 2px sliver; hovering that would be a pinpoint,
        // so the whole column answers: the top of the plot, far above any bar,
        // still reads out the bar under it.
        const over = panel.locator('.nd-chart .u-over');
        const box = await over.boundingBox();
        await over.hover({ position: { x: box.width - 4, y: 2 } });
        await expect(panel.locator('.nd-chart-tip')).toHaveText(/ · \d+/);
    });

    test('the axis header lines up with the rows it labels', async ({ page }) => {
        await openStatsTab(page, 'collection');
        const panel = panelByTitle(page, 'Bookmarks per page');

        // A header on its own grid would drift out of alignment with the rows.
        const cols = await panel.evaluate((el) => {
            const axis = el.querySelector('.config-dist-axis');
            const row = el.querySelector('.config-dist-row');
            if (!axis || !row) return null;
            return {
                axis: getComputedStyle(axis).gridTemplateColumns,
                row: getComputedStyle(row).gridTemplateColumns,
            };
        });
        expect(cols).not.toBeNull();
        expect(cols.axis).toBe(cols.row);
    });
});
