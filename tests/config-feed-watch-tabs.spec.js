// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Watch feeds has tabs like the other sections: Feeds (the list of
 * watched feeds) and Settings (how their news reaches you). A tab shows its
 * body and hides the other; neither is redrawn, so the list keeps what is open
 * in it.
 */
const hash = (page) => page.evaluate(() => window.location.hash);

async function openConfig(page, target = '/') {
    await markWhatsNewSeen(page);
    await page.goto(target);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openThroughRail(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.locator('[data-config-section="feed-watch"]').click();
    await expect(page.locator('[data-fw-tab]').first()).toBeVisible();
}

test('Watch feeds has a Feeds tab and a Settings tab, and opens on Feeds', async ({ page }) => {
    await openConfig(page);
    await openThroughRail(page);

    await expect(page.locator('[data-fw-tab]')).toHaveText(['Feeds', 'Settings']);
    await expect(page.locator('[data-fw-tab="feeds"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#config-fw-list')).toBeVisible();
    await expect(page.locator('#config-fw-settings')).toBeHidden();
    await expect(page.locator('[data-behavior-field="feedWatchWindowMinutes"]')).toBeHidden();
});

test('the Settings tab shows the settings and hides the list, and the address follows', async ({ page }) => {
    await openConfig(page);
    await openThroughRail(page);

    await page.locator('[data-fw-tab="settings"]').click();
    await expect(page.locator('[data-fw-tab="settings"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#config-fw-settings')).toBeVisible();
    await expect(page.locator('#config-fw-list')).toBeHidden();
    await expect(page.locator('[data-behavior-field="feedWatchWindowMinutes"]')).toBeVisible();
    await expect(page.locator('[data-behavior-field="feedWatchNewsView"]')).toBeVisible();
    await expect.poll(() => hash(page)).toBe('#config/feed-watch/settings');

    await page.locator('[data-fw-tab="feeds"]').click();
    await expect(page.locator('#config-fw-list')).toBeVisible();
    await expect(page.locator('#config-fw-settings')).toBeHidden();
    await expect.poll(() => hash(page)).toBe('#config/feed-watch/feeds');
});

test('a link to the Settings tab opens it, and the tab is remembered', async ({ page }) => {
    await openConfig(page, '/#config/feed-watch/settings');
    await expect(page.locator('[data-fw-tab="settings"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-behavior-field="feedWatchWindowMinutes"]')).toBeVisible();

    // Away and back through the rail: the tab it was left on.
    await page.locator('[data-config-section="appearance"]').click();
    await page.locator('[data-config-section="feed-watch"]').click();
    await expect(page.locator('[data-fw-tab="settings"]')).toHaveAttribute('aria-selected', 'true');
});

test('the settings search sends a news setting to the Settings tab', async ({ page }) => {
    await openConfig(page);
    // The index is built from the schema once Config is open.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect(page.locator('[data-config-section="feed-watch"]')).toBeVisible();
    // The jump entry carries the sub-tab; leaving it out would open the list.
    const target = await page.evaluate(() =>
        window.dashboardInstance.config.settingsJumpFieldEntries()
            .find((e) => e.field === 'feedWatchWindowMinutes'));
    expect(target).toMatchObject({ section: 'feed-watch', subTab: 'settings' });

    await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        const entry = cfg.settingsJumpFieldEntries().find((e) => e.field === 'feedWatchWindowMinutes');
        await cfg.activateSettingsJumpEntry(entry);
    });
    await expect(page.locator('[data-fw-tab="settings"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-behavior-field="feedWatchWindowMinutes"]')).toBeVisible();
});
