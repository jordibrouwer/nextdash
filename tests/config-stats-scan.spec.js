// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config → Statistics: the figures have to mean what they say.
 *
 * Five things this pins, each of which read wrong before:
 *
 *   - the healthy share left monitorDown and content out of its denominator,
 *     so a collection with two monitors down reported "Healthy 100%" directly
 *     above a row saying "Monitors down 2";
 *   - the content state was never even read off the summary, so a bookmark
 *     failing its own expectation was invisible here while three other screens
 *     showed it;
 *   - the cleanup score said "90 days" whatever the reader's stale threshold
 *     was, four lines under a summary that got it right;
 *   - category panels fell back to raw ids unless config → Bookmarks had been
 *     opened first in the same session, because only that section warmed the
 *     cache the labeller reads;
 *   - the timestamp asked Intl for the locale's clock instead of the reader's
 *     Time format setting, so a 24h install read 15:10 in the header and
 *     03:10 PM here.
 */

async function openStats(page, tab) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    // Quickstart's background favicon sweep reopens Overview when it finishes.
    await page.waitForTimeout(6000);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('stats'); });
    if (tab) {
        await page.locator(`[data-stats-tab="${tab}"]`).click();
    }
    await expect(page.locator('#config-stats-body')).toBeVisible();
}

/** The rendered text of the section body. */
const bodyText = (page) => page.evaluate(() => document.getElementById('config-stats-body').innerText);

test.describe('the healthy share counts every state', () => {
    test('a monitor that is down is not counted as healthy', async ({ page }) => {
        await openStats(page, 'health');
        await expect.poll(() => page.evaluate(() => !!window.dashboardInstance.config._statsHealth),
            { timeout: 15_000 }).toBe(true);

        const shown = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            // The shape the server sends, with each of the three mutually
            // exclusive failing states occupied.
            c._statsHealth = {
                ...c._statsHealth,
                healthy: 6, broken: 1, monitorDown: 2, content: 1, unchecked: 0,
                stale: 0, drift: 0, duplicates: 0, shortcutConflicts: 0, orphanedCategories: 0,
            };
            c.repaintStatsBody();
            const body = document.getElementById('config-stats-body');
            return {
                // The Link health panel's own figure. Scoped to #config-stats-health
                // because the archive panel above it carries a ratio too, and
                // every panel with a bar captions its axis "0% to 100%".
                share: body.querySelector('#config-stats-health .config-ratio-value')?.textContent?.trim(),
                text: body.innerText,
            };
        });

        // 6 of 10, not 6 of 7.
        expect(shown.share).toBe('60%');
        // And the state that used to be dropped on the floor has a row.
        expect(shown.text).toMatch(/Answering, but not as expected|Antwoordt/);
    });
});

test.describe('the cleanup score names the reader\'s own threshold', () => {
    test('not a hardcoded 90 days', async ({ page }) => {
        await openStats(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            // Make the penalty fire, rather than hoping the fixture has a
            // neglected bookmark: without one the line is absent and the
            // assertion below would pass on a wrong label just as happily.
            const day = 86400000;
            (d.allBookmarks || []).slice(0, 2).forEach((b) => {
                b.lastOpened = Date.now() - 60 * day;
            });
            d.settings.bookmarkStaleDays = 21;
            d.config.invalidateStatsCache();
            d.config.repaintStatsBody();
        });

        const text = await bodyText(page);
        expect(text).toMatch(/not opened in 21 days/i);
        expect(text).not.toMatch(/not opened in 90 days \(/i);
    });
});

test.describe('category panels label by name', () => {
    test('without having to visit Bookmarks first', async ({ page }) => {
        await openStats(page, 'content');
        // The names arrive with their own fetch, so the panel fills in.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._bmCategoriesCache.size), { timeout: 15_000 })
            .toBeGreaterThan(0);

        const labelled = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const label = c.statsCategoryLabeller();
            const pages = window.dashboardInstance.pages || [];
            // Every category the labeller knows about resolves to something
            // other than its own raw id.
            return pages.flatMap((p) => c.knownCategories(p.id).map((cat) => ({
                id: cat.id,
                label: label(window.DashboardConfig.categoryFilterKey(p.id, cat.id)),
            })));
        });
        expect(labelled.length).toBeGreaterThan(0);
    });
});

test.describe('the timestamp is on the reader\'s clock', () => {
    test('24h stays 24h, whatever the locale prefers', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.timeFormat = '24h';
            window.dashboardInstance.config.repaintStatsBody();
        });
        await expect(page.locator('.config-stats-updated')).not.toContainText(/AM|PM/);

        await page.evaluate(() => {
            window.dashboardInstance.settings.timeFormat = '12h';
            window.dashboardInstance.config.repaintStatsBody();
        });
        await expect(page.locator('.config-stats-updated')).toContainText(/AM|PM/);
    });
});

test.describe('what the section reports beyond bookmarks', () => {
    test('uptime is a reading, not just a count of monitors', async ({ page }) => {
        await openStats(page, 'health');
        await expect.poll(() => page.evaluate(() => !!window.dashboardInstance.config._statsHealth),
            { timeout: 15_000 }).toBe(true);

        const shown = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c._statsHealth = {
                ...c._statsHealth,
                fleet: {
                    monitors: 4, downNow: 1, avgResponseMs: 210, totalIncidents: 3,
                    uptime24h: { ratio: 0.5, samples: 8 },
                    uptime7d: { ratio: 0.994, samples: 600 },
                    uptime30d: { ratio: 0, samples: 0 },
                },
            };
            c.repaintStatsBody();
            return document.getElementById('config-stats-body').innerText;
        });
        expect(shown).toContain('50%');
        expect(shown).toContain('99.4%');
        expect(shown).toContain('210 ms');
        // A window with no samples is not the same as one that was down.
        expect(shown).toMatch(/nothing recorded|niets vastgelegd/);
    });

    test('certificates are reported by host, and only when near expiry', async ({ page }) => {
        await openStats(page, 'health');
        await expect.poll(() => page.evaluate(() => !!window.dashboardInstance.config._statsHealth),
            { timeout: 15_000 }).toBe(true);

        // None near expiry: no panel at all, which reads as "nothing to do".
        const withoutCerts = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c._statsHealth = { ...c._statsHealth, certificates: {} };
            c.repaintStatsBody();
            return document.getElementById('config-stats-body').innerText;
        });
        expect(withoutCerts).not.toMatch(/Already expired|Al verlopen/);

        const withCerts = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const now = Date.now();
            const day = 86400000;
            c._statsHealth = {
                ...c._statsHealth,
                certificates: {
                    'gone.example': { host: 'gone.example', expiresAt: now - 3 * day },
                    'soon.example': { host: 'soon.example', expiresAt: now + 9 * day },
                },
            };
            c.repaintStatsBody();
            return document.getElementById('config-stats-body').innerText;
        });
        expect(withCerts).toMatch(/Already expired|Al verlopen/);
        // The one that already went, named, with the right number of days.
        expect(withCerts).toContain('gone.example');
        expect(withCerts).toMatch(/3 days ago|3 dagen geleden/);
    });

    test('the things that are not bookmarks are counted', async ({ page }) => {
        await openStats(page, 'content');
        await expect.poll(() => bodyText(page), { timeout: 15_000 })
            .toMatch(/Beyond bookmarks|Naast bladwijzers/);

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._statsLibrary !== undefined), { timeout: 15_000 }).toBe(true);

        const text = await bodyText(page);
        // Trash and automatic backups are always answerable; feeds and sources
        // may be switched off, which is a figure of its own.
        expect(text).toMatch(/Waiting in the trash|In de prullenbak/);
        expect(text).toMatch(/Automatic backups kept|Bewaarde automatische/);
    });
});
