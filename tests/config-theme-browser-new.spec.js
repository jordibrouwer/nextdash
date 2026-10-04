// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * The latest collection carries a "new" badge, and `new` in the search box
 * narrows the grid to it -- the families the server marks new, no others.
 */
async function openBrowser(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('appearance'); });
    await page.locator('[data-appearance-action="browse-themes"]').first().click();
    await expect(page.locator('[data-theme-card]').first()).toBeAttached();
}

// The families the server marks new, read from its list rather than counted by
// hand: a hard 34 broke the day the Unraid families joined it.
const NEW_FAMILIES = [...fs.readFileSync(path.join(__dirname, '..', 'internal', 'app', 'theme_new.go'), 'utf8')
    .match(/var themeNewFamilies = map\[string\]bool\{([\s\S]*?)\n\}/)[1]
    .matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1]).sort();

test.describe('new themes in the browser', () => {
    test('a new family wears the badge, an older one does not', async ({ page }) => {
        await openBrowser(page);
        await expect(page.locator('[data-theme-card="tidepool-lens"] [data-theme-new]')).toBeVisible();
        await expect(page.locator('[data-theme-card="sea-glass"] [data-theme-new]')).toHaveCount(0);
    });

    test('searching "new" leaves exactly the new families', async ({ page }) => {
        await openBrowser(page);
        const expected = await page.evaluate(async () => {
            const meta = await (await fetch('/api/themes/meta')).json();
            const families = new Set(Object.entries(meta.themes || {})
                .filter(([, m]) => m.new).map(([id]) => id.replace(/-(dark|light)$/, '')));
            return [...families].sort();
        });
        expect(expected).toEqual(NEW_FAMILIES);
        await page.locator('[data-theme-search]').fill('new');
        await expect(page.locator('[data-theme-card]')).toHaveCount(NEW_FAMILIES.length);
        const shown = await page.locator('[data-theme-card]').evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-theme-card')).sort());
        expect(shown).toEqual(expected);
    });
});
