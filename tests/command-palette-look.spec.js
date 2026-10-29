// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The palette is drawn as the other overlays are: the same fill as Recent
 * bookmarks, with the ring and the cast of a layer on top. Set on <body> the way
 * the settings write it; nothing is saved.
 */
for (const material of ['glass', 'brushed', 'lacquer']) {
    test(`the palette on ${material} keeps its mark, ring and cast`, async ({ page }) => {
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
        // The palette's fill is a transition: read it once it has settled.
        await page.waitForTimeout(500);
        const seen = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('.search-container'));
            const m = /\/\s*([\d.]+)\)/.exec(cs.backgroundColor);
            const mark = getComputedStyle(document.querySelector('.search-prompt'), '::before');
            return { alpha: m ? Number(m[1]) : 1, shadow: cs.boxShadow, mark: mark.content, markWidth: parseFloat(mark.width), titleCase: getComputedStyle(document.querySelector('.search-prompt .search-prefix')).textTransform, titleSpacing: parseFloat(getComputedStyle(document.querySelector('.search-prompt .search-prefix')).letterSpacing) || 0 };
        });
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

/*
 * As opaque as Recent bookmarks, on every material: the palette took its fill
 * from the categories once (their alpha plus a tenth, never under 0.7), and on
 * glass read as a thinner veil than the panels it opens beside.
 */
for (const material of ['glass', 'brushed', 'lacquer']) {
    test(`on ${material} the palette is as opaque as Recent bookmarks, whatever the categories are`, async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate((m) => {
            document.body.dataset.materialStyle = 'signature';
            document.body.dataset.material = m;
            // Categories as glass: the old rule thinned the palette to follow them.
            document.body.style.setProperty('--cat-glass-alpha', '0.5');
        }, material);
        const fill = (selector) => page.evaluate(async (sel) => {
            await new Promise((r) => setTimeout(r, 450));
            return getComputedStyle(document.querySelector(sel)).backgroundColor;
        }, selector);

        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        const palette = await fill('.search-container');
        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.toggleRecentBookmarksModal());
        await expect(page.locator('#app-modal.show .recent-bookmarks-modal')).toBeVisible({ timeout: 5_000 });
        const recent = await fill('.recent-bookmarks-modal');
        expect(palette, 'the palette and Recent bookmarks are filled differently').toBe(recent);
    });
}
