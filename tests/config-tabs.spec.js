// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Appearance and Behavior open straight on a tab of settings.
 *
 * They opened on a start screen of tiles for a while, with each group split
 * into a few cards and "More settings" -- an extra click in, a second layer
 * inside, and settings that could not be found without guessing the tile.
 * What this pins is the way back to plain tabs: every setting of a tab on the
 * tab, the preview beside Appearance following the tab, and the filter saying
 * where else a setting lives.
 */

async function open(page, hash) {
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
}

const hash = (page) => page.evaluate(() => window.location.hash);

test('Appearance opens on its first tab, with the settings already there', async ({ page }) => {
    await open(page, '#config/appearance');
    await expect(page.locator('[data-appearance-tab]')).toHaveText(
        ['Look', 'Grid', 'Rows', 'Header', 'Action bar', 'Date & weather']);
    await expect(page.locator('[data-appearance-tab="general"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-appearance-select="fontPreset"]')).toBeVisible();
    await expect(page.locator('.config-preview')).toHaveAttribute('data-preview-focus', 'all');
});

test('Behavior has five tabs, and the moved settings are where the tabs say', async ({ page }) => {
    await open(page, '#config/behavior');
    await expect(page.locator('[data-behavior-tab]')).toHaveText(
        ['General', 'Keyboard & search', 'Inbox & Fresh', 'Status & alerts', 'Privacy & sync']);

    await page.locator('[data-behavior-tab="search"]').click();
    await expect(page.locator('[data-behavior-field="globalShortcuts"]')).toBeVisible();
    await page.locator('[data-behavior-tab="inbox"]').click();
    await expect(page.locator('[data-behavior-field="feedsEnabled"]')).toBeVisible();
    await page.locator('[data-behavior-tab="privacy"]').click();
    await expect(page.locator('[data-behavior-field="enableSessionTips"]')).toBeVisible();
    await expect(page.locator('[data-behavior-field="deviceSpecificSettings"]')).toBeVisible();
});

test('an old tab link opens the tab that holds its settings now', async ({ page }) => {
    await open(page, '#config/behavior/fresh');
    await expect(page.locator('[data-behavior-tab="inbox"]')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => hash(page)).toBe('#config/behavior/inbox');

    await page.goto('/#config/appearance/grid');
    await expect(page.locator('[data-appearance-tab="layout"]')).toHaveAttribute('aria-selected', 'true');
});

test('the tab last looked at is where the section opens next time', async ({ page }) => {
    await open(page, '#config/appearance');
    await page.locator('[data-appearance-tab="display"]').click();
    await expect(page.locator('[data-appearance-tab="display"]')).toHaveAttribute('aria-selected', 'true');

    // A later visit, past the five minutes config remembers its location for:
    // that entry is gone before the page runs, so only the tab memory is left.
    const later = await page.context().newPage();
    await later.addInitScript(() => localStorage.removeItem('nextdash:config-last-location-v1'));
    await later.goto('/#config/appearance');
    await expect(later.locator('[data-appearance-tab="display"]')).toHaveAttribute('aria-selected', 'true');
});

test('the preview follows the tab and the setting', async ({ page }) => {
    await open(page, '#config/appearance/buttonbar');
    const preview = page.locator('.config-preview');
    await expect(preview).toHaveAttribute('data-preview-focus', 'actions');

    await page.locator('[data-appearance-tab="layout"]').click();
    await expect(preview).toHaveAttribute('data-preview-focus', 'grid');
    const columns = page.locator('input[data-behavior-field="columnsPerRow"]');
    await columns.fill('5');
    await columns.dispatchEvent('change');
    await expect(preview).toHaveAttribute('data-preview-cols', '5');

    // Behavior has no preview.
    await page.goto('/#config/behavior');
    await expect(page.locator('[data-behavior-tab]').first()).toBeVisible();
    await expect(page.locator('.config-preview')).toHaveCount(0);
});

test('every schema setting carries a short line saying what it does', async ({ page }) => {
    await open(page, '#config/appearance/header');
    const row = page.locator('[data-behavior-field="showPageTabs"]').locator('xpath=ancestor::div[contains(@class,"config-field-row")]');
    await expect(row.locator('xpath=following-sibling::p[1]')).toHaveClass(/config-field-hint/);
});

test('the filter names the other tabs a setting is on, and goes there', async ({ page }) => {
    await open(page, '#config/behavior/general');
    const filter = page.locator('[data-settings-filter]');
    await filter.fill('keyboard');
    const elsewhere = page.locator('[data-filter-elsewhere="search"]');
    await expect(elsewhere).toBeVisible();
    await elsewhere.click();

    await expect(page.locator('[data-behavior-tab="search"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-behavior-field="globalShortcuts"]')).toBeVisible();
    await expect(page.locator('[data-settings-filter]')).toHaveValue('keyboard');
});

/**
 * The bar in the band takes input.
 *
 * The band is filled after the panels are bound, so the filter field and the
 * "Only changed" button were written into a head nobody came back to: both
 * looked alive and neither reached the config object. The filter's symptom was
 * a tab that said nothing matched while the word was in the box.
 */
test('the filter and the changed toggle in the band are wired up', async ({ page }) => {
    await open(page, '#config/behavior/general');

    await page.locator('[data-settings-filter]').fill('keyboard');
    await expect.poll(() => page.evaluate(() =>
        window.dashboardInstance.config.settingsFilter), { timeout: 5_000 }).toBe('keyboard');

    await page.locator('[data-settings-filter]').fill('');
    await expect.poll(() => page.evaluate(() =>
        window.dashboardInstance.config.settingsFilter), { timeout: 5_000 }).toBe('');

    const toggle = page.locator('[data-config-action="toggle-changed"]');
    if (await toggle.isEnabled()) {
        await toggle.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.changedOnly === true), { timeout: 5_000 }).toBe(true);
    }
});
