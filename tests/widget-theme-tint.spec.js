// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A readout belongs to the page it stands on.
 *
 * The cells were a tint of the text colour, and on every theme that read as a
 * grey-white panel. They are the page's own colour one step off it now, so they
 * keep its hue -- measured on a page with a clear one, since on a near-neutral
 * page a near-neutral cell is the right answer and proves nothing.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/**
 * How far a colour is from grey, as the spread across its channels.
 *
 * Parsed rather than measured through a canvas: the computed colour is the
 * cell's own, with nothing behind it mixed in.
 */
const spread = (colour) => {
    const numbers = [...colour.matchAll(/[\d.]+/g)].map((m) => parseFloat(m[0]));
    if (colour.startsWith('color(')) {
        const [r, g, b] = numbers;
        return Math.max(r, g, b) - Math.min(r, g, b);
    }
    const [r, g, b] = numbers;
    return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
};

/** A warm brown page: a hue nobody could mistake for grey. */
const PAGE = 'rgb(70, 50, 30)';

/** Mounts a widget inside a real card, on a brown page, and reads back from it. */
const readWidget = (page) => page.evaluate((ground) => {
    const card = document.querySelector('.category') || document.body;
    const widget = document.createElement('div');
    widget.className = 'dashboard-widget';
    widget.style.setProperty('--background-primary', ground);
    const body = document.createElement('div');
    body.className = 'dashboard-widget-body';
    const stats = document.createElement('div');
    stats.className = 'dashboard-widget-stats';
    const stat = document.createElement('button');
    stat.className = 'dashboard-widget-stat';
    const meter = document.createElement('div');
    meter.className = 'dashboard-widget-meter';
    stats.append(stat, meter);
    body.appendChild(stats);
    widget.appendChild(body);
    card.appendChild(widget);

    const value = {
        cell: window.getComputedStyle(stat).backgroundColor,
        meter: window.getComputedStyle(meter).backgroundColor,
    };
    widget.remove();
    return value;
}, PAGE);

test.describe('widget tints follow the theme', () => {
    // The page's own spread is 40/255, about 0.157. Half of it is a generous
    // floor: the accent tint and, on the track, a share of the ink mix in.
    test('a readout cell carries the page colour, not a grey', async ({ page }) => {
        await dashboard(page);
        const { cell } = await readWidget(page);

        expect(spread(cell), `the cell is a grey on a brown page: ${cell}`).toBeGreaterThan(0.078);
    });

    test('and so does the meter track', async ({ page }) => {
        await dashboard(page);
        const { meter } = await readWidget(page);

        expect(spread(meter), `the meter track is a grey: ${meter}`).toBeGreaterThan(0.078);
    });

    test('a cell lights the same way however you reach it', async ({ page }) => {
        await dashboard(page);

        const lit = await page.evaluate(() => {
            const card = document.querySelector('.category') || document.body;
            const widget = document.createElement('div');
            widget.className = 'dashboard-widget';
            const make = (extra) => {
                const stat = document.createElement('button');
                stat.className = `dashboard-widget-stat${extra}`;
                widget.appendChild(stat);
                return stat;
            };
            const selected = make(' keyboard-selected');
            const hovered = make('');
            card.appendChild(widget);

            // :hover cannot be forced from script, so this reads the rule that
            // would apply rather than the state: the two selectors have to
            // resolve to one declaration, which is what broke.
            // The declaration is the `background` shorthand holding a var(),
            // which the CSSOM cannot expand -- style.backgroundColor comes
            // back empty, so this reads the shorthand itself.
            const rules = [...document.styleSheets].flatMap((sheet) => {
                try { return [...sheet.cssRules]; } catch { return []; }
            }).filter((rule) => rule.selectorText
                && rule.selectorText.includes('button.dashboard-widget-stat:hover')
                && (rule.style.background || rule.style.backgroundColor));

            const value = {
                selected: window.getComputedStyle(selected).backgroundColor,
                hoverRules: rules.map((rule) => rule.style.background || rule.style.backgroundColor),
            };
            widget.remove();
            return value;
        });

        expect(lit.hoverRules.length, `more than one hover ground: ${lit.hoverRules}`).toBe(1);
        expect(lit.hoverRules[0], 'the hover ground is not the accent tint')
            .toContain('--accent-primary');
        expect(spread(lit.selected), `the keyboard cursor lands on a grey: ${lit.selected}`)
            .toBeGreaterThan(0.02);
    });
});
