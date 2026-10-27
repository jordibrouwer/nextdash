// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A docked action bar that is in view stands on a layer of its own, and a
 * button that is on is filled with the accent. Set on <body> the way the
 * settings write it; nothing is saved.
 */
async function ready(page, material) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((m) => {
        document.body.dataset.actionBar = 'right';
        document.body.dataset.materialStyle = 'signature';
        document.body.dataset.material = m;
        document.body.removeAttribute('data-action-bar-hidden');
    }, material);
}

const dock = (page) => page.evaluate(() => {
    const bar = document.querySelector('.dashboard-section.section-controls .header-shortcuts');
    const cs = getComputedStyle(bar);
    // The wash is a layer over the material's own paint, not its replacement.
    const wash = getComputedStyle(bar, '::after');
    const alpha = (c) => {
        const m = /\/\s*([\d.]+)\)/.exec(c);
        return m ? Number(m[1]) : (c.startsWith('rgba(') ? Number(c.split(',')[3]) : 1);
    };
    return { alpha: alpha(wash.backgroundColor), washed: wash.content !== 'none' && wash.content !== 'normal', filter: cs.filter, border: cs.borderTopColor };
});

for (const material of ['brushed', 'glass', 'paper', 'neon']) {
    test(`the docked bar in view is dense and casts a shadow on ${material}`, async ({ page }) => {
        await ready(page, material);
        const shown = await dock(page);
        // Tens of percent of wash: enough to part it from the cards, short of covering the material.
        expect(shown.washed).toBe(true);
        expect(shown.alpha, 'the wash is too thin to part the dock from the cards').toBeGreaterThanOrEqual(0.5);
        expect(shown.alpha, 'the wash covers the material').toBeLessThanOrEqual(0.75);
        expect(shown.filter).toContain('drop-shadow');
        // Slid away, it is not drawn at all, so nothing here changes it.
        await page.evaluate(() => document.body.setAttribute('data-action-bar-hidden', ''));
        expect((await dock(page)).filter).not.toContain('drop-shadow');
    });
}

test('a button that is on is filled with the accent', async ({ page }) => {
    await ready(page, 'brushed');
    const lit = await page.evaluate(async () => {
        const button = document.getElementById('search-button');
        const idle = getComputedStyle(button).backgroundColor;
        button.classList.add('is-active');
        // The buttons transition their paint: read it once it has settled.
        await new Promise((r) => setTimeout(r, 600));
        const on = getComputedStyle(button).backgroundColor;
        return { idle, on };
    });
    expect(lit.on).not.toBe(lit.idle);
    expect(lit.on).toMatch(/\/ 0\.22\)|0\.22\)/);
});
