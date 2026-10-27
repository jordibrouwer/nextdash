// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The palette is drawn like a category (a wash, so the material still shows), with the
 * ring and the cast of a layer on top. Set on <body> the way the settings write
 * it; nothing is saved.
 */
for (const material of ['glass', 'brushed', 'lacquer']) {
    test(`the palette lets the ${material} show through and keeps its ring and cast`, async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate((m) => {
            document.body.dataset.materialStyle = 'signature';
            document.body.dataset.material = m;
        }, material);
        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        await page.waitForTimeout(500);
        const seen = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('.search-container'));
            const m = /\/\s*([\d.]+)\)/.exec(cs.backgroundColor);
            const mark = getComputedStyle(document.querySelector('.search-prompt'), '::before');
            return { alpha: m ? Number(m[1]) : 1, shadow: cs.boxShadow, mark: mark.content, markWidth: parseFloat(mark.width), titleCase: getComputedStyle(document.querySelector('.search-prompt .search-prefix')).textTransform, titleSpacing: parseFloat(getComputedStyle(document.querySelector('.search-prompt .search-prefix')).letterSpacing) || 0 };
        });
        expect(seen.alpha, 'the palette is a dense slab again').toBeLessThanOrEqual(0.8);
        expect(seen.alpha, 'the palette is see-through again').toBeGreaterThanOrEqual(0.6);
        // The mark every column head opens with.
        expect(seen.mark).toBe('""');
        expect(seen.markWidth).toBeGreaterThan(10);
        // The title is set as a column head is in that material: brushed in spaced capitals.
        if (material === 'brushed') {
            expect(seen.titleCase).toBe('uppercase');
            expect(seen.titleSpacing).toBeGreaterThan(1);
        }
        // The ring (a 2px spread) and the cast that part it from the page.
        expect(seen.shadow).toMatch(/0px 0px 0px 2px/);
        expect(seen.shadow).toMatch(/\d+px \d+px \d+px -\d+px/);
    });
}

test('an opaque theme gets an opaque palette, a glass one a veil', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        document.body.dataset.materialStyle = 'signature';
        document.body.dataset.material = 'brushed';
    });
    await page.keyboard.press(':');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    const alpha = () => page.evaluate(async () => {
        await new Promise((r) => setTimeout(r, 450));
        const m = /\/\s*([\d.]+)\)/.exec(getComputedStyle(document.querySelector('.search-container')).backgroundColor);
        return m ? Number(m[1]) : 1;
    });
    // The categories as glass (alpha 0.5): the palette a tenth over them, never under 0.7.
    await page.evaluate(() => {
        document.body.style.setProperty('--cat-glass-alpha', '0.5');
    });
    const veil = await alpha();
    expect(veil).toBeGreaterThanOrEqual(0.69);
    expect(veil).toBeLessThan(0.8);
    // Categories lifted to opaque: the palette follows.
    await page.evaluate(() => document.body.style.setProperty('--cat-glass-alpha', '1'));
    expect(await alpha()).toBeGreaterThanOrEqual(0.99);
});
