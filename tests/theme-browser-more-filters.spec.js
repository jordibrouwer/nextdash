// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The filters above the theme grid. All, Favourites, Light and Dark stay in
 * view; character and collection fold away under "More filters", so the grid
 * starts higher. A filter that is on while folded shows as a chip with a ×,
 * and the count of cards left rides in the In use line.
 */
async function openStudio(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await page.waitForSelector('[data-theme-browser]', { timeout: 20_000 });
}

test('character and collection fold under More filters, and one that is on stays in view as a chip', async ({ page }) => {
    await openStudio(page);
    const cards = page.locator('[data-theme-card]');
    const more = page.locator('[data-theme-more]');
    const all = await cards.count();
    expect(all, 'the browser opened empty').toBeGreaterThan(20);

    // Folded at first: the light/dark segments are there, the characters not.
    await expect(page.locator('[data-theme-segment="dark"]')).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-theme-character]')).toHaveCount(0);
    await expect(page.locator('[data-theme-inuse] .theme-browser-count')).toContainText(`${all} of ${all}`);

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.locator('[data-theme-character="velvet"]').click();
    await expect.poll(() => cards.count()).toBeLessThan(all);
    const velvet = await cards.count();
    await expect(page.locator('[data-theme-inuse] .theme-browser-count')).toContainText(`${velvet} of ${all}`);

    // Folding keeps the filter, and says so.
    await more.click();
    await expect(page.locator('[data-theme-character]')).toHaveCount(0);
    expect(await cards.count(), 'folding dropped the filter').toBe(velvet);
    const chip = page.locator('[data-theme-clear="character"]');
    await expect(chip).toContainText('Velvet');
    await expect(more).toContainText('1');

    // The × is the way back to everything.
    await chip.click();
    await expect.poll(() => cards.count()).toBe(all);
    await expect(page.locator('[data-theme-clear]')).toHaveCount(0);
    await expect(more).not.toContainText('1');
});
