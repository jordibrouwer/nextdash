// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two ways Statistics used to overstate what it was showing.
 *
 * The ranked panels cut off silently: "Never opened" heads itself "candidates
 * to tidy up", listed ten rows, and let you believe that was all — while the
 * cleanup panel beside it counted the real number. And the CSV export carried
 * no opens or activity data at all, while writing rows labelled `tag:` from a
 * list already capped at ten: a partial export dressed as a complete one.
 */

const LIMIT = 20;

/** Seeds enough bookmarks to overflow the cap on every ranked list. */
async function seedAndOpenStats(page, { opened = 40, never = 20, tags = 25 } = {}) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
    await page.evaluate(({ opened, never, tags }) => {
        const d = window.dashboardInstance;
        const now = Date.now();
        const pageId = d.pages[0].id;
        d.allBookmarks = Array.from({ length: opened + never }, (_, i) => ({
            name: `BM ${String(i).padStart(3, '0')}`,
            url: `https://x${i}.example.com/`,
            pageId,
            category: `cat${i % 3}`,
            tags: [`tag${i % tags}`],
            openCount: i < opened ? i + 1 : 0,
            lastOpened: i < opened ? now - (i % 20) * 86400000 : 0,
        }));
    }, { opened, never, tags });
}

/** Runs the export and returns the CSV text, without touching the filesystem. */
const exportCsv = (page) => page.evaluate(async () => {
    const c = window.dashboardInstance.config;
    let csv = '';
    const original = c.triggerDownload;
    c.triggerDownload = async (blob) => { csv = await blob.text(); };
    try {
        await c.exportStatsCSV();
        await new Promise((r) => setTimeout(r, 250));
    } finally {
        c.triggerDownload = original;
    }
    return csv;
});

test.describe('statistics: lists say when they cut off', () => {
    test('a truncated list reports the real total', async ({ page }) => {
        await seedAndOpenStats(page);
        const counts = await page.evaluate(() => {
            const s = window.dashboardInstance.config.computeStats();
            return {
                shown: s.topOpened.length,
                total: s.listTotals.topOpened,
                tagsShown: s.topTags.length,
                tagsTotal: s.listTotals.topTags,
            };
        });
        expect(counts.shown).toBe(LIMIT);
        expect(counts.total).toBe(40);
        expect(counts.tagsShown).toBe(LIMIT);
        expect(counts.tagsTotal).toBe(25);
    });

    test('the note is visible and names both numbers', async ({ page }) => {
        await seedAndOpenStats(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.statsTab = 'activity';
            c.repaintStatsBody();
        });
        const note = page.locator('.config-list-truncated').first();
        await expect(note).toBeVisible();
        await expect(note).toContainText(String(LIMIT));
        await expect(note).toContainText('40');
    });

    test('a list that fits shows no note', async ({ page }) => {
        // Fewer rows than the cap: nothing was hidden, so nothing to say.
        await seedAndOpenStats(page, { opened: 5, never: 2, tags: 3 });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.statsTab = 'activity';
            c.repaintStatsBody();
        });
        const panel = page.locator('.config-panel')
            .filter({ has: page.locator('.config-panel-title', { hasText: 'Most opened' }) }).first();
        await expect(panel.locator('.config-list-truncated')).toHaveCount(0);
    });

    test('Never opened hands off the rows it could not show', async ({ page }) => {
        await seedAndOpenStats(page, { opened: 5, never: 40, tags: 5 });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.statsTab = 'activity';
            c.repaintStatsBody();
        });
        const panel = page.locator('.config-panel')
            .filter({ has: page.locator('.config-panel-title', { hasText: 'Never opened' }) }).first();
        const button = panel.locator('[data-cleanup-goto="never"]');
        await expect(button).toBeVisible();

        // It must actually land on the filtered bookmarks list, or the note
        // points at nothing.
        await button.click();
        await expect(page.locator('#config-bm-list')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.config.bmCleanupFilter)).toBe('never');
    });
});

test.describe('statistics: the CSV export is complete', () => {
    test('it carries the opens and activity data it used to omit', async ({ page }) => {
        await seedAndOpenStats(page);
        const csv = await exportCsv(page);
        const lines = csv.split('\n');

        // None of these existed in the export before.
        for (const key of ['opens_total,', 'activity_range_days,', 'activity_bucket_days,',
            'activity_bookmarks_used,', 'bookmarks_ever_opened,', 'top10_share_of_opens_pct,']) {
            expect(lines.some((l) => l.startsWith(key)), `missing ${key}`).toBe(true);
        }
        // And the chart series itself, one row per bar.
        expect(lines.filter((l) => l.startsWith('bookmarks_last_used:')).length).toBeGreaterThan(1);
    });

    test('its per-item rows are not capped at what the panel shows', async ({ page }) => {
        await seedAndOpenStats(page);
        const lines = (await exportCsv(page)).split('\n');

        // The panel shows 20; the export must carry all 40 and all 25.
        expect(lines.filter((l) => l.startsWith('bookmark_opens:')).length).toBe(40);
        expect(lines.filter((l) => l.startsWith('tag:')).length).toBe(25);
    });

    test('values with commas stay quoted', async ({ page }) => {
        await seedAndOpenStats(page, { opened: 3, never: 0, tags: 2 });
        await page.evaluate(() => {
            window.dashboardInstance.allBookmarks[0].name = 'Comma, in "name"';
        });
        const csv = await exportCsv(page);
        // One row per record still: a raw comma would split a row in two.
        // The label is prefixed, so the whole field is quoted as one unit.
        const row = csv.split('\n').find((l) => l.includes('Comma'));
        expect(row).toContain('"bookmark_opens:Comma, in ""name"""');
        expect(row.split(',').length).toBeGreaterThan(1);
    });
});
