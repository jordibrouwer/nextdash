// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

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
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
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

test.describe('statistics: what the activity chart counts', () => {
    /**
     * A bookmark holds a cumulative openCount and one lastOpened, with no
     * per-open history. The chart used to add the whole openCount to the bucket
     * of lastOpened, so a lifetime of use landed on a single day: 100 opens
     * gathered over a year drew a bar of 100 on the Tuesday it was last
     * touched. Each bookmark now counts once, which is what the data supports.
     */
    async function seedAndCompute(page, seed) {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
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
        await openStatsTab(page, 'activity');

        const panel = page.locator('.config-panel').first();
        // The old title promised a series the data cannot support.
        await expect(panel.locator('.config-panel-title')).not.toHaveText(/opens over time/i);
        await expect(panel.locator('.config-panel-note')).toContainText(/last use/i);
    });
});

test.describe('statistics: chart axis labels', () => {
    test('the activity chart names both axes', async ({ page }) => {
        await openStatsTab(page, 'activity');
        const panel = panelByTitle(page, 'Bookmarks used over time');

        // y: what the bars count, plus a real top tick rather than an unlabelled
        // scale. The bars count bookmarks, not opens — the axis must say so.
        await expect(panel.locator('.config-chart-axis-title')).toHaveText(/bookmarks/i);
        const ticks = panel.locator('.config-chart-axis-ticks span');
        await expect(ticks).toHaveCount(2);
        await expect(ticks.last()).toHaveText('0');
        expect(Number(await ticks.first().innerText())).toBeGreaterThan(0);

        // x: what one bar covers.
        await expect(panel.locator('.config-chart-axis-x')).toBeVisible();
    });

    test('the x-axis label follows the selected range', async ({ page }) => {
        await openStatsTab(page, 'activity');
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
        await openStatsTab(page, 'activity');

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
        await openStatsTab(page, 'content');

        const perPage = panelByTitle(page, 'Bookmarks per page').locator('.config-dist-axis');
        await expect(perPage.locator('.config-dist-axis-label')).toHaveText(/page/i);
        await expect(perPage.locator('.config-dist-axis-value')).toHaveText(/bookmarks/i);

        const perCat = panelByTitle(page, 'Bookmarks per category').locator('.config-dist-axis');
        await expect(perCat.locator('.config-dist-axis-label')).toHaveText(/category/i);
    });

    test('the coverage bars state the scale they share', async ({ page }) => {
        await openStatsTab(page, 'content');
        const caption = panelByTitle(page, 'Coverage').locator('.config-chart-scale');
        await expect(caption).toBeVisible();
        // Names the denominator and the range, so a bar is not just "some width".
        await expect(caption).toHaveText(/0%\s*to\s*100%/i);
    });

    test('every axis caption is hidden from screen readers', async ({ page }) => {
        await openStatsTab(page, 'content');
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
        await openStatsTab(page, 'activity');
        const svg = panelByTitle(page, 'Bookmarks used over time').locator('svg');
        const box = await svg.boundingBox();
        // 72px was too short for a day-to-day comparison; 108 is that plus half.
        expect(box.height).toBeGreaterThanOrEqual(100);
        // The y-axis ticks must span the plot, or max/0 stop meaning top/baseline.
        const ticks = await panelByTitle(page, 'Bookmarks used over time')
            .locator('.config-chart-axis-ticks').boundingBox();
        expect(Math.abs(ticks.height - box.height)).toBeLessThanOrEqual(2);
    });

    test('the x-axis carries dated ticks, not just its two ends', async ({ page }) => {
        await openStatsTab(page, 'activity');
        const ticks = panelByTitle(page, 'Bookmarks used over time').locator('.config-chart-tick');
        const n = await ticks.count();
        expect(n).toBeGreaterThan(2);
        // Capped so labels cannot collide into a smear on 30 bars. The cap
        // adapts to label width, so this is the ceiling, not a fixed count.
        expect(n).toBeLessThanOrEqual(7);
        // Real dates, not "12d ago".
        await expect(ticks.first()).not.toHaveText(/ago/i);
    });

    test('no tick escapes the plot or collides, at any range', async ({ page }) => {
        await openStatsTab(page, 'activity');

        // The wide weekly labels ("Jul 29 – Aug 4") overflowed the panel and ran
        // into each other: the end ticks were centred on their bar, so half the
        // text sat outside, and six of them did not fit at that width.
        for (const range of ['7', '30', '90', '365']) {
            const panel = panelByTitle(page, 'Bookmarks used over time');
            await panel.locator(`[data-stats-range="${range}"]`).click();
            const after = panelByTitle(page, 'Bookmarks used over time');
            await expect(after.locator('.config-chart-tick').first()).toBeVisible();

            const geo = await after.evaluate((el) => {
                const host = el.querySelector('.config-chart-ticks').getBoundingClientRect();
                const ticks = [...el.querySelectorAll('.config-chart-tick')];
                const outside = ticks.filter((t) => {
                    const b = t.getBoundingClientRect();
                    return b.left < host.left - 1 || b.right > host.right + 1;
                }).map((t) => t.textContent);
                let collide = 0;
                for (let i = 1; i < ticks.length; i++) {
                    const a = ticks[i - 1].getBoundingClientRect();
                    const b = ticks[i].getBoundingClientRect();
                    if (a.right + 4 > b.left) collide++;
                }
                return { outside, collide, count: ticks.length };
            });

            expect(geo.outside, `${range}d: ticks outside the plot`).toEqual([]);
            expect(geo.collide, `${range}d: ticks touching`).toBe(0);
            expect(geo.count).toBeGreaterThan(1);
        }
    });

    test('hovering a bar shows its value and its date', async ({ page }) => {
        await openStatsTab(page, 'activity');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        const bars = panel.locator('.config-chart-bar');
        expect(await bars.count()).toBeGreaterThan(0);

        const tip = panel.locator('.config-chart-tip');
        // Clicking the tab left the pointer inside the panel, which may already
        // be over a bar — park it somewhere neutral before asserting the
        // resting state.
        await page.mouse.move(2, 2);
        await expect(tip).toBeHidden();

        const box = await bars.last().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
        await expect(tip).toBeVisible();
        // Value leads, date follows.
        await expect(tip.locator('strong')).toHaveText(/\d+/);
        await expect(tip.locator('span')).not.toBeEmpty();

        // Leaving the chart clears it.
        await page.mouse.move(box.x + box.width / 2, box.y - 200);
        await expect(tip).toBeHidden();
    });

    test('the same values are reachable by keyboard, not hover only', async ({ page }) => {
        await openStatsTab(page, 'activity');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        const bar = panel.locator('.config-chart-bar').first();

        await bar.focus();
        await expect(panel.locator('.config-chart-tip')).toBeVisible();
        // And to a screen reader, which never gets a pointer at all.
        await expect(bar).toHaveAttribute('aria-label', /\d+/);
    });

    test('the bar hit target is bigger than the painted bar', async ({ page }) => {
        await openStatsTab(page, 'activity');
        const panel = panelByTitle(page, 'Bookmarks used over time');
        // A one-open day paints a 2px sliver; hovering that would be a pinpoint,
        // so the hit rect spans the full plot height and half the gap each side.
        const sizes = await panel.locator('.config-chart-bar').first().evaluate((g) => {
            const hit = g.querySelector('.config-chart-bar-hit').getBoundingClientRect();
            const fill = g.querySelector('.config-chart-bar-fill').getBoundingClientRect();
            return { hitH: hit.height, fillH: fill.height, hitW: hit.width, fillW: fill.width };
        });
        expect(sizes.hitH).toBeGreaterThan(sizes.fillH);
        expect(sizes.hitW).toBeGreaterThan(sizes.fillW);
    });

    test('the axis header lines up with the rows it labels', async ({ page }) => {
        await openStatsTab(page, 'content');
        const panel = panelByTitle(page, 'Bookmarks per category');

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
