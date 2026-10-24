// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What has to stay readable on a layer in the material.
 *
 * A native select lists its options on its own background, so the list shows whatever is behind it
 * when that background is see-through. A list a reader clicks in is nearly closed. The dots of a
 * tutorial that are not yet reached have to show against the card.
 */
const THEME_PER_MATERIAL = {
    glass: 'arctic-cyan-dark',
    frost: 'hoarfrost-dark',
    aurora: 'borealis-veil-dark',
    neon: 'cold-cathode-dark',
    terminal: 'retro-crt-mk2-dark',
    ink: 'nocturne-ink-dark',
    paper: 'candlelit-study-dark',
    enamel: 'bone-china-dark',
    velvet: 'forest-everglade-dark',
    lacquer: 'gloss-jade-dark',
    brushed: 'foundry-iron-dark',
    carbon: 'graphite-twill-dark',
};

async function setTheme(request, theme) {
    const response = await request.post('/api/settings', {
        data: { theme, materialStyle: 'signature' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok(), 'settings save failed').toBe(true);
}

async function open(page, hash) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/#' + hash);
    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForTimeout(300);
}

/** The alpha of a computed colour, 1 when it has none. */
const alphaOf = (color) => {
    const m = String(color).match(/\/\s*([\d.]+)\s*\)$/) || String(color).match(/^rgba\(.*,\s*([\d.]+)\s*\)$/);
    return m ? Number(m[1]) : 1;
};

test.describe('legibility on the layers', () => {
    test.afterEach(async ({ request }) => {
        await setTheme(request, 'aurora-glass-dark');
    });

    test('a select in the config view lists its options on a closed background, in every material', async ({ page, request }) => {
        test.setTimeout(180_000);
        for (const [material, theme] of Object.entries(THEME_PER_MATERIAL)) {
            await setTheme(request, theme);
            await open(page, 'config');
            await page.locator('.config-nav-item', { hasText: 'Appearance' }).first().click();
            await page.waitForSelector('#dashboard-layout.config-layout select', { state: 'attached', timeout: 10_000 });
            const selects = await page.evaluate(() => [...document.querySelectorAll('#dashboard-layout.config-layout select')]
                .map((el) => getComputedStyle(el).backgroundColor));
            expect.soft(selects.length, material + ': the config view has no select to look at').toBeGreaterThan(0);
            for (const color of selects) expect.soft(alphaOf(color), material + ': a select is see-through: ' + color).toBe(1);
        }
    });

    test('a list a reader clicks in is nearly closed, in every material', async ({ page, request }) => {
        test.setTimeout(180_000);
        for (const [material, theme] of Object.entries(THEME_PER_MATERIAL)) {
            await setTheme(request, theme);
            await open(page, '');
            const alpha = await page.evaluate(() => {
                const el = document.createElement('div');
                el.className = 'move-popover';
                el.style.cssText = 'position:fixed;left:20px;top:20px;width:120px;height:60px';
                document.body.appendChild(el);
                const color = getComputedStyle(el).backgroundColor;
                el.remove();
                return color;
            });
            expect.soft(alphaOf(alpha), material + ': a popover list lets the page show through: ' + alpha).toBeGreaterThanOrEqual(0.95);
        }
    });

    test('the dots of a tutorial that are not reached show against the card', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await open(page, '');
        const dot = await page.evaluate(() => {
            const el = document.createElement('span');
            el.className = 'dashboard-tutorial-dot';
            document.body.appendChild(el);
            const cs = getComputedStyle(el);
            const value = { bg: cs.backgroundColor, width: cs.width };
            el.remove();
            return value;
        });
        expect(alphaOf(dot.bg), 'an unreached dot is nearly invisible: ' + dot.bg).toBeGreaterThanOrEqual(0.3);
        expect(parseFloat(dot.width)).toBeGreaterThanOrEqual(8);
    });
});
