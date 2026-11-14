// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The name a form suggests from the page, cleaned, with the original on offer.
 *
 * The server takes a login word or the site's own name off a page title
 * (page_title_clean.go) and sends the title it started from as originalTitle.
 * The form shows the clean one, and a turned arrow at the end of the name field
 * switches to the original and back; typing a name of your own removes it.
 */
test('the suggested name is the clean title, and the original comes back with one click', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Radarr', originalTitle: 'Login - Radarr', description: '' }),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+Shift+A');
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(form.locator('[data-field="url"]')).toBeFocused();
    await page.keyboard.type(`https://radarr.example/${Date.now()}`);
    await page.keyboard.press('Tab');

    const name = form.locator('[data-field="name"]');
    await expect(name).toHaveValue('Radarr');
    const restore = form.locator('.bookmark-form-name-restore');
    await expect(restore).toBeVisible();

    await restore.click();
    await expect(name).toHaveValue('Login - Radarr');
    await restore.click();
    await expect(name).toHaveValue('Radarr');

    // A name the reader types is theirs: the arrow goes.
    await name.fill('My Radarr');
    await expect(restore).toBeHidden();
});

test('a title that needed no cleaning offers no original', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Plain page', description: '' }),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+Shift+A');
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(form.locator('[data-field="url"]')).toBeFocused();
    await page.keyboard.type(`https://plain.example/${Date.now()}`);
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-field="name"]')).toHaveValue('Plain page');
    await expect(form.locator('.bookmark-form-name-restore')).toBeHidden();
});
