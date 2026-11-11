// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Instrument group draws the data into the row. Three things have to hold:
 * a row that has history or a ping gets a gauge while an instrument-* theme is
 * on, the gauge is gone again after switching to an ordinary theme, and a
 * bookmark nobody has measured gets nothing -- no invented trace.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 1, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Give the first bookmark a heartbeat; every other one stays unmeasured. */
async function stubHealth(page) {
    // Real pings would give other rows a measurement of their own.
    await page.route('**/api/ping**', (route) => route.abort());
    const first = await page.evaluate(() => window.dashboardInstance.allBookmarks[0].url);
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            generatedAt: Date.now(),
            summary: {},
            rows: [{ url: first, monitor: true, uptime30d: 0.97, uptime30dSamples: 40, heartbeat: 'uuuuduuuuxuuuuuuuuuu' }],
        }),
    }));
    // The dashboard's own load may still have a real report in flight that
    // would replace this one; read until the stub is what the facts hold.
    await expect.poll(async () => page.evaluate(async (url) => {
        await window.HealthBadgeUtils.fetchBookmarkHealthSummary();
        return window.HealthFacts.get(url)?.heartbeat?.length || 0;
    }, first)).toBeGreaterThan(0);
    return first;
}

async function use(page, theme) {
    await page.evaluate(async (t) => {
        const d = window.dashboardInstance;
        await d.config.ensureSection('appearance');
        await d.config.setTheme(t);
    }, theme);
}

const row = (page, url) => page.locator(`.category:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${url}"]`).first();

test.describe('instrument themes put the data in the row', () => {
    test('a measured row gets a gauge, an unmeasured one nothing, and it all leaves with the theme', async ({ page }) => {
        await openDashboard(page);
        const first = await stubHealth(page);

        await use(page, 'instrument-cockpit-dark');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'instrument-cockpit-dark');

        // The history is drawn as a trace on the measured row.
        await expect(row(page, first).locator('.ig-gauge .ig-spark .ig-trace')).toHaveCount(1);
        // The same beats back the cockpit's histogram: one bar per measured beat.
        await expect(row(page, first).locator('.ig-hist rect')).toHaveCount(20);
        // The gauge ignores the pointer, so it never takes a click from the row.
        await expect(row(page, first).locator('.ig-gauge')).toHaveCSS('pointer-events', 'none');
        // It sits outside the row's grid: the row keeps its three children.
        await expect(row(page, first).locator(':scope > .bookmark-lead, :scope > .bookmark-open, :scope > .bookmark-shortcut')).toHaveCount(3);

        // Nobody recorded a history for the rest, so no other row gets a trace. (A
        // row the status monitor really pinged may carry a ping bar; that is a
        // measurement, not an invention.)
        const others = await page.evaluate((url) => [...document.querySelectorAll('.category:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url]')]
            .filter((r) => r.getAttribute('data-bookmark-url') !== url)
            .filter((r) => r.querySelector('.ig-spark')).map((r) => r.getAttribute('data-bookmark-url')), first);
        expect(others).toEqual([]);

        // The category head of the measured row counts what it knows.
        const category = page.locator('.category:not([data-smart-collection="true"])', { has: page.locator(`.bookmark-link[data-bookmark-url="${first}"]`) }).first();
        await expect(category.locator('.ig-count')).toHaveText(/^\d+\/\d+$/);
        await expect(category.locator('.ig-meter > i').first()).toBeVisible();

        // Switching to an ordinary theme takes every added node and attribute away.
        await use(page, 'look-ocean-dark');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'look-ocean-dark');
        await expect(page.locator('.ig-gauge, .ig-meter, .ig-count')).toHaveCount(0);
        await expect(page.locator('[data-ig], [data-ig-sig], [data-ig-state]')).toHaveCount(0);
    });

    test('a ping the status monitor cached becomes the number and the bar', async ({ page }) => {
        await openDashboard(page);
        const first = await stubHealth(page);
        await page.evaluate((url) => {
            window.dashboardInstance.statusMonitor.statusCache.set(statusCacheKey(url), { status: 'online', ping: 120, confirmed: true, timestamp: Date.now() });
        }, first);

        await use(page, 'instrument-cockpit-dark');
        await expect(row(page, first).locator('.ig-ms')).toHaveText('120ms');
        await expect(row(page, first).locator('.ig-bar > i')).toHaveCSS('width', /^[1-9]/);
    });

    test('each family replaces the card with its own instrument', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'instrument-cockpit-dark');
        const category = page.locator('.category:not([data-smart-collection="true"])').first();
        // Cockpit: no fill and no edge at all, only brackets and hairlines.
        await expect(category).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(category).toHaveCSS('border-top-width', '0px');
        await use(page, 'instrument-oscilloscope-dark');
        // Oscilloscope: a thick bezel with rounded screen corners.
        await expect(category).toHaveCSS('border-top-width', '10px');
        await expect(category).toHaveCSS('border-top-left-radius', '30px');
        await use(page, 'instrument-dive-computer-dark');
        // Dive computer: a pill of metal, drawn as a transparent border over a gradient.
        await expect(category).toHaveCSS('border-top-width', '8px');
        await expect(category).toHaveCSS('border-top-left-radius', '38px');
    });

    test('the gauge never covers the link in its row', async ({ page }) => {
        await openDashboard(page);
        const first = await stubHealth(page);
        await use(page, 'instrument-dive-computer-dark');
        const target = row(page, first);
        await expect(target.locator('.ig-gauge')).toHaveCount(1);
        // The link inside the row is what a click lands on; the gauge is not in the way.
        const hit = await target.locator('.bookmark-open').evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!top && (top === el || el.contains(top));
        });
        expect(hit).toBe(true);
    });
});
