// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A widget sits in the page, not on it.
 *
 * The tile body took a step up the surface ladder -- towards the ink -- which
 * on every theme read as a grey-white panel pasted on the dashboard. It is the
 * page's own colour one step off it now -- lighter on a dark theme, darker on a
 * light one -- with its cells one step further. Solid with no lit edges on
 * flat, soft and rich; under glass the same colour, see-through and blurred,
 * with the lit edge back so it reads as a pane.
 */
const read = (page, depth, ground, dir) => page.evaluate(([value, bg, inkDir]) => {
    document.body.setAttribute('data-depth', value);
    const widget = document.createElement('div');
    widget.className = 'dashboard-widget';
    if (bg) widget.style.setProperty('--background-primary', bg);
    if (inkDir) widget.style.setProperty('--ink-dir', inkDir);
    const body = document.createElement('div');
    body.className = 'dashboard-widget-body';
    const cell = document.createElement('div');
    cell.className = 'dashboard-widget-stat';
    body.appendChild(cell);
    widget.appendChild(body);
    document.getElementById('dashboard-layout').appendChild(widget);
    // The page colour resolved through a painted property, so it comes back
    // as numbers in the same form as the tile's.
    const pageProbe = document.createElement('div');
    pageProbe.style.backgroundColor = 'var(--background-primary)';
    widget.appendChild(pageProbe);
    const style = window.getComputedStyle(body);
    const out = {
        blur: style.backdropFilter,
        body: style.backgroundColor,
        cell: window.getComputedStyle(cell).backgroundColor,
        page: window.getComputedStyle(pageProbe).backgroundColor,
        shadow: style.boxShadow,
    };
    widget.remove();
    return out;
}, [depth, ground, dir]);

/** Channels as 0-1 numbers, alpha last (1 when absent). */
const channels = (colour) => {
    const n = [...colour.matchAll(/[\d.]+/g)].map((m) => parseFloat(m[0]));
    const scale = colour.startsWith('color(') ? 1 : 255;
    return { rgb: n.slice(0, 3).map((v) => v / scale), alpha: n[3] ?? 1 };
};
const lightness = (colour) => channels(colour).rgb.reduce((a, b) => a + b, 0);

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

for (const depth of ['flat', 'soft', 'rich']) {
    test(`the widget is solid, with no lit edges, at ${depth}`, async ({ page }) => {
        await dashboard(page);
        const seen = await read(page, depth);

        expect(channels(seen.body).alpha, `see-through: ${seen.body}`).toBe(1);
        expect(channels(seen.cell).alpha, `see-through cell: ${seen.cell}`).toBe(1);
        expect(seen.shadow, 'the tile carries the lit edges').not.toContain('inset');
    });
}

test('under glass the tile and its cells are see-through and blurred, with a lit edge', async ({ page }) => {
    await dashboard(page);
    const seen = await read(page, 'glass');

    expect(channels(seen.body).alpha, `solid under glass: ${seen.body}`).toBeLessThan(1);
    expect(channels(seen.cell).alpha, `solid cell under glass: ${seen.cell}`).toBeLessThan(1);
    expect(seen.blur, `no blur under glass: ${seen.blur}`).toMatch(/blur\((?!0px)/);
    expect(seen.shadow, 'no lit edge under glass').toContain('inset');
});

const apart = (a, b) => channels(a).rgb.reduce((sum, v, i) => sum + Math.abs(v - channels(b).rgb[i]), 0);

test('on a dark page the tile and its cells step up, in the page colour', async ({ page }) => {
    await dashboard(page);
    const seen = await read(page, 'rich', 'rgb(70, 50, 30)', '1');

    expect(lightness(seen.body), `tile not lighter than page: ${seen.body} on ${seen.page}`)
        .toBeGreaterThan(lightness(seen.page));
    expect(lightness(seen.cell), `cell not lighter than tile: ${seen.cell} on ${seen.body}`)
        .toBeGreaterThan(lightness(seen.body));
    // A small step, not a panel: the grey-white it replaced sat far above.
    expect(apart(seen.body, seen.page), `tile jumps off the page: ${seen.body}`).toBeLessThan(0.3);
    // Still brown: red over green over blue, as the page is.
    const [r, g, b] = channels(seen.cell).rgb;
    expect(r > g && g > b, `the cell lost the page's hue: ${seen.cell}`).toBe(true);
});

test('on a light page they step down', async ({ page }) => {
    await dashboard(page);
    const seen = await read(page, 'rich', 'rgb(240, 236, 228)', '-1');

    expect(lightness(seen.body), `tile not darker than page: ${seen.body} on ${seen.page}`)
        .toBeLessThan(lightness(seen.page));
    expect(lightness(seen.cell), `cell not darker than tile: ${seen.cell} on ${seen.body}`)
        .toBeLessThan(lightness(seen.body));
});

test('on a near-black page the tile still stands apart', async ({ page }) => {
    await dashboard(page);
    const seen = await read(page, 'rich', 'rgb(3, 7, 5)', '1');

    expect(apart(seen.body, seen.page), `tile is the page's colour: ${seen.body}`).toBeGreaterThan(0.06);
    expect(apart(seen.cell, seen.body), `cell is the tile's colour: ${seen.cell}`).toBeGreaterThan(0.06);
});
