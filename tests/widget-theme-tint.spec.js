// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A readout belongs to the card it stands in.
 *
 * The cells a widget is built from are a tint of the text colour over the
 * card, so that on a dark theme they lift and on a light one they sink -- one
 * step towards the reader either way. They mixed --text-secondary to do it,
 * and --text-secondary is not the theme's ink: theme-ink.css derives it from
 * the surface with `calc(c * 0.5)`, half the chroma of a ground that on a
 * dark theme has almost none. Halving almost none leaves none, so on a green
 * dashboard the readouts came out grey -- measured at srgb(0.723 0.761 0.733)
 * on retro-crt-dark against a #C7FFCC ink.
 *
 * The cells mix --text-primary now, which comes straight from the theme with
 * its chroma intact. Nothing about the direction changed; only the hue.
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
 * Parsed rather than measured through a canvas: the cells are translucent, so
 * painting them over a ground would mix the ground's own hue back in and the
 * reading would say more about the card than about the tint.
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

/** Mounts a widget inside a real card and reads back from it. */
const readWidget = (page) => page.evaluate(() => {
    const card = document.querySelector('.category') || document.body;
    const widget = document.createElement('div');
    widget.className = 'dashboard-widget';
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

    const ink = document.createElement('span');
    ink.style.backgroundColor = 'var(--text-primary)';
    body.appendChild(ink);

    const value = {
        cell: window.getComputedStyle(stat).backgroundColor,
        meter: window.getComputedStyle(meter).backgroundColor,
        ink: window.getComputedStyle(ink).backgroundColor,
    };
    widget.remove();
    return value;
});

test.describe('widget tints follow the theme', () => {
    test('a readout cell carries the theme colour, not a grey', async ({ page }) => {
        await dashboard(page);
        const { cell, ink } = await readWidget(page);

        // Guard first: on a greyscale theme a grey cell is the correct answer,
        // and the assertion below would pass for the wrong reason.
        expect(spread(ink), `the theme's ink is neutral, so this proves nothing: ${ink}`)
            .toBeGreaterThan(0.05);

        // Half the ink's own spread is a generous floor -- the tint is a mix,
        // so it is never as saturated as what it mixes. The grey it replaced
        // measured 0.038 against an ink of 0.220.
        expect(spread(cell), `the cell is a grey on a themed dashboard: ${cell}`)
            .toBeGreaterThan(spread(ink) / 2);
    });

    test('and so does the meter track', async ({ page }) => {
        await dashboard(page);
        const { meter, ink } = await readWidget(page);

        expect(spread(meter), `the meter track is a grey: ${meter}`)
            .toBeGreaterThan(spread(ink) / 2);
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
