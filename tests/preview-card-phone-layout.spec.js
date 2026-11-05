// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The hover card is off in the phone layout and comes back as the window
 * widens: the rows keep their handlers, only the showing is gated.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = 'hover';
        d.settings.showLinkPreviewCards = true;
        d.settings.linkPreviewHoverDelayMs = 100;
        // No network: the card draws whatever preview is handed to it.
        d.preview.fetchBookmarkPreviewData = async (link, bookmark) => ({
            title: bookmark.name, description: 'A description', image: '', url: bookmark.url,
        });
        d.renderDashboard({ animate: false, forceFull: true });
    });
}

const firstRow = (page) => page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])').first();
const card = (page) => page.locator('#bookmark-preview-card.is-visible');

async function hoverRow(page) {
    await page.mouse.move(2, 2);
    await firstRow(page).scrollIntoViewIfNeeded();
    await firstRow(page).hover();
}

test('the card is off in the phone layout and back at a wider window', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDashboard(page);

    await hoverRow(page);
    await expect(card(page)).toBeVisible({ timeout: 8000 });

    // The window narrows to a phone: the open card goes, and no new one opens.
    await page.setViewportSize({ width: 600, height: 900 });
    await expect(card(page)).toHaveCount(0);
    // Pacing: the layout redraws as the width changes, and a hover before it settles is on a row that goes.
    await page.waitForTimeout(600);
    await hoverRow(page);
    // Checks that nothing happens: the hover delay is 100 ms, so after this a card would have opened.
    await page.waitForTimeout(900);
    await expect(card(page)).toHaveCount(0);

    // Wider again: the same rows open cards, without a redraw.
    await page.setViewportSize({ width: 1280, height: 900 });
    // The layout redraws as the width changes; a hover before it settles is on a row that goes.
    await page.waitForTimeout(600);
    await hoverRow(page);
    await expect(card(page)).toBeVisible({ timeout: 8000 });
});
