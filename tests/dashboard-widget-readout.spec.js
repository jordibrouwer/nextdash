// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * How a tile reads at a glance.
 *
 * A dashboard is scanned, not read, so the figures are the instrument and
 * everything else is a caption on it. Three things carry that, and all three
 * were measured rather than judged: the number outweighs its label, a nought
 * is calm so the eye lands on the figure that is not one, and the block of
 * figures is a surface of its own rather than loose text on the card.
 */
async function withWidgets(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        for (const n of [1, 2, 3]) {
            await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
                name: `Dead ${n}`, url: `http://127.0.0.1:9/${n}`,
                lastError: 'Connection refused', lastChecked: 1787600000000, checkStatus: true } }) });
        }
        await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({
            widgets: [{ type: 'health', title: 'Status' }, { type: 'archive', title: 'Copies' }] }) });
        // The report is kept for minutes; ask for it to be rebuilt so the
        // figures below are this test's own.
        await f('/api/bookmark-health?view=facts&refresh=1');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(async () => page.evaluate(() =>
        Number(window.dashboardInstance?.healthSummary?.totalBookmarks) || 0),
    { timeout: 20_000 }).toBeGreaterThan(0);
}

/** A computed colour as three 0-255 channels, whatever notation it came in. */
const CHANNELS = `(value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return (resolved.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
}`;

test.describe('a widget reads as an instrument', () => {
    test('the number outweighs the word under it', async ({ page }) => {
        await withWidgets(page);
        const type = await page.evaluate(() => {
            const cell = document.querySelector('.dashboard-widget-stat');
            const value = getComputedStyle(cell.querySelector('.dashboard-widget-stat-value'));
            const label = getComputedStyle(cell.querySelector('.dashboard-widget-stat-label'));
            return {
                value: parseFloat(value.fontSize),
                label: parseFloat(label.fontSize),
                tabular: value.fontVariantNumeric,
            };
        });
        /*
         * Clearly larger, not larger by a stated amount.
         *
         * Measured at 21px against 14px, which is exactly half again -- and
         * asserting exactly that put the test on a knife edge, where a theme
         * with a different small size or a rounding a pixel the other way
         * fails it without anything having regressed. What must not come back
         * is the two being within a hair of each other, which is what made a
         * tile read as a paragraph of digits rather than a set of readings.
         */
        expect(type.value / type.label).toBeGreaterThan(1.35);
        // Columns of figures only line up when the digits are the same width.
        expect(type.tabular).toContain('tabular-nums');
    });

    test('a nought is calm and a figure that needs someone is not', async ({ page }) => {
        await withWidgets(page);
        const tone = await page.evaluate((channelsSource) => {
            const channels = eval(channelsSource);
            const rows = [...document.querySelectorAll('.dashboard-widget-health-row')];
            const read = (filter) => {
                const row = rows.find((r) => r.dataset.healthFilter === filter);
                const el = row?.querySelector('.dashboard-widget-health-value');
                return {
                    count: Number(el?.textContent),
                    colour: channels(getComputedStyle(el).color),
                    quiet: row?.classList.contains('is-quiet'),
                };
            };
            return {
                broken: read('broken'),
                down: read('monitored'),
                tertiary: channels(getComputedStyle(document.documentElement)
                    .getPropertyValue('--text-tertiary').trim()),
            };
        }, CHANNELS);

        // The scenario has to have produced a problem, or there is nothing to
        // tell apart.
        expect(tone.broken.count).toBeGreaterThan(0);
        expect(tone.down.count).toBe(0);

        // The nought is dimmed to the same ink every other caption uses...
        expect(tone.down.quiet).toBe(true);
        expect(tone.down.colour).toEqual(tone.tertiary);
        // ...and the figure that is not a nought is not.
        expect(tone.broken.quiet).toBe(false);
        expect(tone.broken.colour).not.toEqual(tone.tertiary);
    });

    test('the figures are a surface of their own, one step off the card', async ({ page }) => {
        await withWidgets(page);
        const surfaces = await page.evaluate((channelsSource) => {
            const channels = eval(channelsSource);
            const tile = document.querySelector('.dashboard-widget[data-widget-type="archive"]');
            const card = tile.querySelector('.dashboard-widget-body');
            const cell = tile.querySelector('.dashboard-widget-stat');
            const paint = (el) => {
                // What the pixel actually is: these surfaces are translucent
                // on purpose, so the declared value is not the answer.
                const rect = el.getBoundingClientRect();
                return { rect: [Math.round(rect.width), Math.round(rect.height)] };
            };
            return {
                card: channels(getComputedStyle(card).backgroundColor),
                cell: channels(getComputedStyle(cell).backgroundColor),
                cellAlpha: (getComputedStyle(cell).backgroundColor.match(/[\d.]+/g) || [])[3],
                gap: parseFloat(getComputedStyle(
                    tile.querySelector('.dashboard-widget-stats')).rowGap),
                size: paint(cell),
            };
        }, CHANNELS);

        /*
         * Translucent, and that is the load-bearing part.
         *
         * Mixed with a named background instead, the cell landed wherever that
         * background happened to be: measured across four themes it came out
         * lighter than the card on two and darker on the other two, and twice
         * the difference was under one percent -- a readout indistinguishable
         * from the card it sits on. A tint composites over whatever the card
         * turned out to be, so it always moves one step in the direction of
         * the text, on every theme.
         */
        expect(Number(surfaces.cellAlpha)).toBeGreaterThan(0);
        expect(Number(surfaces.cellAlpha)).toBeLessThan(1);
        // The hairline between cells is the grid's gap showing through.
        expect(surfaces.gap).toBe(1);
        expect(surfaces.size.rect[0]).toBeGreaterThan(0);
    });
});
