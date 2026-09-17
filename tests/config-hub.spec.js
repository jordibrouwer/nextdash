// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Appearance and Behavior open on a start screen of tiles. A tile
 * opens its group: the basics as cards, the rest under "More settings", and a
 * preview (Appearance) or an illustration (Behavior) beside them.
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

test.describe('the start screen', () => {
    test('Appearance shows a tile per group and no settings', async ({ page }) => {
        await open(page, '#config/appearance');
        const tiles = page.locator('[data-hub-start="appearance"] [data-hub-group]');
        await expect(tiles).toHaveCount(5);
        await expect(page.locator('[data-hub-group="grid"]')).toContainText('Grid');
        await expect(page.locator('[data-behavior-field]')).toHaveCount(0);
    });

    test('Behavior shows its six groups', async ({ page }) => {
        await open(page, '#config/behavior');
        await expect(page.locator('[data-hub-start="behavior"] [data-hub-group]')).toHaveCount(6);
    });

    test('a tile opens its group, and Back and Escape return', async ({ page }) => {
        await open(page, '#config/appearance');
        await page.locator('[data-hub-group="header"] .hub-tile-main').click();
        await expect(page.locator('.hub-title')).toHaveText('Header & buttons');
        expect(await hash(page)).toBe('#config/appearance/header');

        await page.locator('[data-hub-back="appearance"]').click();
        await expect(page.locator('[data-hub-start="appearance"]')).toBeVisible();
        expect(await hash(page)).toBe('#config/appearance');

        await page.locator('[data-hub-group="datetime"] .hub-tile-main').click();
        await expect(page.locator('.hub-title')).toHaveText('Date & weather');
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-hub-start="appearance"]')).toBeVisible();
        // The first Escape went to the tiles, not out of config.
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('an old tab link opens the group that holds the tab', async ({ page }) => {
        await open(page, '#config/appearance/buttonbar');
        await expect(page.locator('.hub-title')).toHaveText('Header & buttons');
        await expect(page.locator('.hub-subtabs [data-appearance-tab="buttonbar"]')).toHaveAttribute('aria-selected', 'true');

        await open(page, '#config/appearance/display');
        await expect(page.locator('.hub-title')).toHaveText('Grid');

        await open(page, '#config/behavior/search');
        await expect(page.locator('.hub-title')).toHaveText('Search');
    });

    test('a tile summary follows the setting it names', async ({ page }) => {
        await open(page, '#config/appearance/header');
        await page.locator('[data-hub-field="pageSwitcherStyle"][data-hub-value="compact"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.pageSwitcherStyle)).toBe('compact');
        const label = await page.locator('[data-hub-field="pageSwitcherStyle"][data-hub-value="compact"] .hub-choice-label').innerText();

        await page.locator('[data-hub-back="appearance"]').click();
        await expect(page.locator('[data-hub-group="header"] .hub-tile-summary')).toContainText(label);
    });
});

test.describe('a group page', () => {
    test('a basics card saves the setting and moves the preview', async ({ page }) => {
        await open(page, '#config/appearance/layout');
        const preview = page.locator('.hub-preview');
        await page.locator('[data-hub-field="columnsPerRow"][data-hub-value="3"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.columnsPerRow)).toBe(3);
        await expect(preview).toHaveAttribute('data-preview-cols', '3');
        await expect(page.locator('[data-hub-field="columnsPerRow"][data-hub-value="3"]')).toHaveAttribute('aria-pressed', 'true');

        // It was saved, not only drawn.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.settings.columnsPerRow)).toBe(3);
    });

    test('the weather location is a card of its own, typed into and saved', async ({ page }) => {
        await open(page, '#config/appearance/datetime');
        const field = page.locator('[data-hub-text="weatherLocation"]');
        await expect(field).toBeVisible();

        await field.fill('Leiden');
        await field.press('Enter');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.weatherLocation)).toBe('Leiden');

        // It was saved, not only drawn.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.settings.weatherLocation)).toBe('Leiden');
    });

    test('the preview follows a change made under More settings', async ({ page }) => {
        await open(page, '#config/appearance/buttonbar');
        await page.locator('[data-hub-field="actionBarPosition"][data-hub-value="left"]').click();
        await expect(page.locator('.hub-preview')).toHaveAttribute('data-preview-actions', 'left');
    });

    test('More settings holds every field of the group, basics included', async ({ page }) => {
        await open(page, '#config/appearance/header');
        const more = page.locator('[data-hub-more="appearance:header"]');
        await expect(more.locator('[data-behavior-field="maxPageTabs"]')).toHaveCount(1);
        // Full control stays reachable: a card offers the common values only.
        await expect(more.locator('[data-behavior-field="pageSwitcherStyle"]')).toHaveCount(1);
        await expect(page.locator('.hub-basics [data-hub-card="pageSwitcherStyle"]')).toHaveCount(1);
    });

    test('More settings starts closed and remembers being opened', async ({ page }) => {
        await page.addInitScript(() => {
            if (sessionStorage.getItem('hubFoldSeeded')) return;
            sessionStorage.setItem('hubFoldSeeded', '1');
            localStorage.setItem('nextdash.hubMore.behavior:search', '0');
        });
        await open(page, '#config/behavior/search');
        const more = page.locator('[data-hub-more="behavior:search"]');
        await expect(more).not.toHaveAttribute('open', '');
        await expect(more.locator('[data-behavior-field="interleaveMode"]')).toBeHidden();

        await more.locator('summary').click();
        await expect(more.locator('[data-behavior-field="interleaveMode"]')).toBeVisible();

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('[data-hub-more="behavior:search"]')).toHaveAttribute('open', '');
    });

    test('a Behavior group has a card per basic and an illustration', async ({ page }) => {
        await open(page, '#config/behavior/inbox');
        await expect(page.locator('[data-hub-card="inboxEnabled"]')).toHaveCount(1);
        await expect(page.locator('.hub-ill')).toBeVisible();
        await expect(page.locator('.hub-preview')).toHaveCount(0);
    });
});

test.describe('searching from the start screen', () => {
    test('finds a field in another group and opens that group', async ({ page }) => {
        await open(page, '#config/appearance');
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.settingsFilter = 'Temperature unit';
            c.render();
        });
        const hit = page.locator('[data-hub-hits="datetime"]');
        await expect(hit).toBeVisible();
        await expect(hit.locator('[data-behavior-field="weatherUnit"]')).toHaveCount(1);
        await expect(page.locator('[data-hub-hits="grid"]')).toHaveCount(0);

        await hit.locator('.hub-hits-title').click();
        await expect(page.locator('.hub-title')).toHaveText('Date & weather');
    });
});
