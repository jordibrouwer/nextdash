// @ts-check
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, markConfigSettingPromosSeen } = require('./e2e-helpers');

/**
 * Opens Config → Bookmarks → List through the real UI: the `<` shortcut
 * (Shift+Comma) that jumps to config, then a click on the bookmarks section
 * tab. Shared by every workbench spec so each one keeps testing behaviour,
 * not a fabricated shortcut into it.
 */
async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await markConfigSettingPromosSeen(page);
    await page.keyboard.press('Shift+Comma');
    await page.waitForSelector('[data-config-section="bookmarks"]', { timeout: 15_000 });
    await page.click('[data-config-section="bookmarks"]');
    await page.waitForSelector('#config-bm-workbench #config-bm-list .config-bm-row', { timeout: 15_000 });
}

module.exports = { openBookmarks };
