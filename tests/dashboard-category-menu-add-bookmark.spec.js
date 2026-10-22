// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The right-click menu on a category header offers "Add new bookmark", which
 * opens the add-bookmark form with that category already chosen.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('Add new bookmark in a category menu opens the form on that category', async ({ page }) => {
    await openDashboard(page);
    const id = await page.evaluate(() => {
        const cats = window.dashboardInstance.categories || [];
        // Any stored category that is on screen and is not the first one, so a
        // form that merely defaults to the first category would not pass.
        const shown = cats.filter((c) => [...document.querySelectorAll('.category')]
            .some((el) => el.getAttribute('data-category-id') === String(c.id)));
        return String((shown[1] || shown[0]).id);
    });

    const title = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
    await title.scrollIntoViewIfNeeded();
    await title.click({ button: 'right' });

    const menu = page.locator('#category-context-menu');
    const entries = menu.locator('[role="menuitem"]');
    await expect(entries.first()).toContainText('Add new bookmark');
    await entries.first().click();

    const modal = page.locator('#bookmark-form-modal.show');
    await expect(modal).toBeVisible();
    const selected = await modal.locator('select').evaluateAll(
        (els, want) => els.map((s) => /** @type {HTMLSelectElement} */ (s).value).includes(want),
        id,
    );
    expect(selected).toBe(true);
});
