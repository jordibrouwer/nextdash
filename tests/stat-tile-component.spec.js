// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One figure with a caption under it, drawn by one component.
 *
 * Config's statistics and a dashboard widget's readout are the same object at
 * two sizes, and were two implementations: config assembled template strings
 * in three helpers plus `renderTile`, the widgets built DOM in `statGrid`.
 * They drifted twice before this -- first the label's case and tracking, then
 * the delta tones -- and both times the drift was spotted by eye and repaired
 * in two files. Neither repair stopped the third.
 *
 * Both markup sites keep their own class as well, because both carry rules
 * that belong to their setting: config's severity stripe down the left edge,
 * a widget cell's ground drawing the hairline grid around it. What is shared
 * is the treatment, and that is what these tests hold.
 */

async function openConfigStats(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.config != null, null, { timeout: 20_000 });
    // 'stats', not 'statistics' -- the section key, not its heading.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForSelector('.config-tile', { timeout: 20_000 });
}

/** The style of a probe carrying the given classes, mounted where it lives. */
const styleOf = (page, classes, host) => page.evaluate(([names, selector]) => {
    const parent = document.querySelector(selector) || document.body;
    const probe = document.createElement('span');
    probe.className = names;
    parent.appendChild(probe);
    const style = window.getComputedStyle(probe);
    const size = parseFloat(style.fontSize) || 1;
    const value = {
        transform: style.textTransform,
        // Tracking as a share of the type it sits in: both are declared in em,
        // so the computed pixels differ with the size, which is the em doing
        // its job rather than a disagreement.
        tracking: Math.round((parseFloat(style.letterSpacing) || 0) / size * 1000) / 1000,
        colour: style.color,
        fontSize: size,
    };
    probe.remove();
    return value;
}, [classes, host]);

test.describe('the stat tile component', () => {
    test('config draws its statistics with it', async ({ page }) => {
        await openConfigStats(page);

        const shape = await page.evaluate(() => {
            const tile = document.querySelector('.config-tile');
            return {
                shared: tile.classList.contains('stat-tile'),
                size: tile.classList.contains('stat-tile--md'),
                value: tile.querySelector('.stat-tile-figure > .stat-tile-value') !== null,
                label: tile.querySelector('.stat-tile-label') !== null,
            };
        });

        expect(shape.shared, 'a config tile is still its own component').toBe(true);
        expect(shape.size, 'the tile does not say which size it is').toBe(true);
        expect(shape.value, 'the figure is not the shared one').toBe(true);
        expect(shape.label, 'the caption is not the shared one').toBe(true);
    });

    test('a widget readout draws with the same one', async ({ page }) => {
        await openConfigStats(page);

        const shape = await page.evaluate(() => {
            const grid = window.DashboardWidgetUtils.statGrid([
                { label: 'broken', value: 2, tone: 'bad' },
                { label: 'healthy', value: 8, tone: 'good' },
            ]);
            const cell = grid.querySelector('.dashboard-widget-stat');
            return {
                shared: cell.classList.contains('stat-tile'),
                size: cell.classList.contains('stat-tile--sm'),
                value: cell.querySelector('.stat-tile-figure > .stat-tile-value') !== null,
                legacy: cell.querySelector('.dashboard-widget-stat-value') !== null,
            };
        });

        expect(shape.shared, 'a widget cell is still its own component').toBe(true);
        expect(shape.size, 'the cell does not say which size it is').toBe(true);
        expect(shape.value, 'the figure is not the shared one').toBe(true);
        // The widget's own sheet still owns what belongs to its setting, so the
        // legacy name has to survive alongside the shared one.
        expect(shape.legacy, 'the widget lost the name its own rules select on').toBe(true);
    });

    test('and the caption reads the same in both', async ({ page }) => {
        await openConfigStats(page);

        const config = await styleOf(page, 'stat-tile stat-tile--md', '.config-tiles');
        const widget = await styleOf(page, 'stat-tile stat-tile--sm', '#dashboard-layout');
        const configLabel = await styleOf(page, 'stat-tile-label', '.config-tile');
        const widgetLabel = await styleOf(page, 'stat-tile-label', '#dashboard-layout');

        expect(configLabel.transform, 'one of them shouts its captions').toBe(widgetLabel.transform);
        expect(configLabel.tracking, 'two ideas of how wide to track a caption').toBe(widgetLabel.tracking);
        expect(configLabel.colour, 'two ideas of how dim a caption is').toBe(widgetLabel.colour);
        void config; void widget;
    });

    test('the two sizes stay different, because they are', async ({ page }) => {
        await openConfigStats(page);

        const sizes = await page.evaluate(() => {
            const read = (size) => {
                const tile = document.createElement('div');
                tile.className = `stat-tile stat-tile--${size}`;
                const value = document.createElement('span');
                value.className = 'stat-tile-value';
                tile.appendChild(value);
                document.querySelector('.config-tiles').appendChild(tile);
                const px = parseFloat(window.getComputedStyle(value).fontSize);
                tile.remove();
                return px;
            };
            return { md: read('md'), sm: read('sm') };
        });

        // A statistics tile is the content of its page; a widget figure is one
        // cell in a tile on a dashboard. Sharing the component is not the same
        // as flattening them to one size.
        expect(sizes.md, 'the two sizes collapsed into one').toBeGreaterThan(sizes.sm);
    });

    test('a nought is dimmed the same way wherever it stands', async ({ page }) => {
        await openConfigStats(page);

        const quiet = await page.evaluate(() => {
            const host = document.querySelector('.config-tiles');
            const read = (extra) => {
                const tile = document.createElement('div');
                tile.className = `stat-tile stat-tile--good${extra}`;
                const value = document.createElement('span');
                value.className = 'stat-tile-value';
                tile.appendChild(value);
                host.appendChild(tile);
                const colour = window.getComputedStyle(value).color;
                tile.remove();
                return colour;
            };
            return { loud: read(''), quiet: read(' is-quiet') };
        });

        expect(quiet.quiet, 'a nought is painted as news').not.toBe(quiet.loud);
    });
});
