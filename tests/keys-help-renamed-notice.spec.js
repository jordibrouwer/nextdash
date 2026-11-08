// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A bell tip that the cheat sheet is now Keys and help: for an existing install,
 * once the window about the moved keys has been answered; never for a fresh one.
 */

const row = (page) => page.locator('.notification-bell-row[data-bell-id="keys-help-renamed-notice"]');

async function load(page, { fresh = false } = {}) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.ShortcutsChangedModal && window.DashboardKeysHelpRenamedNotice && window.NotificationBell, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((isFresh) => {
        const ds = window.DiscoverabilityState;
        ds.schedulePersist = () => {}; // probes must not reach the shared ./data
        window.dashboardInstance.settings.firstRunInstall = isFresh;
        localStorage.removeItem(window.ShortcutsChangedModal.LOCAL_KEY);
        ds.resetSettingPromoSeen('shortcuts-reworked-v1', { persist: false });
        ds.resetSettingPromoSeen('keys-help-renamed-v1', { persist: false });
    }, fresh);
}

/** Answer the window about the moved keys the way a reader does: tick, then Continue. */
async function answerShortcutsWindow(page) {
    await page.evaluate(() => window.ShortcutsChangedModal.ask());
    await expect(page.locator('#app-modal .shortcuts-changed-modal')).toBeVisible({ timeout: 15_000 });
    await page.locator('#sc-changed-ack').check();
    await page.locator('#modal-actions .modal-button').first().click();
    await expect(page.locator('#app-modal .shortcuts-changed-modal')).toHaveCount(0);
}

test('an existing install gets the tip only after the window about the keys is answered', async ({ page }) => {
    await load(page);
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await expect(row(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await answerShortcutsWindow(page);
    await page.evaluate(() => window.NotificationBell.open());
    await expect(row(page)).toContainText('The cheat sheet is now Keys and help');
});

test('its button opens Keys and help and the tip is gone for good', async ({ page }) => {
    await load(page);
    await answerShortcutsWindow(page);
    await page.evaluate(() => window.NotificationBell.open());
    await row(page).getByRole('button', { name: 'Open Keys and help' }).click();
    await expect(page.locator('#app-modal.show .keyboard-cheat-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await expect(row(page)).toHaveCount(0);
});

test('a fresh install never gets it', async ({ page }) => {
    await load(page, { fresh: true });
    await page.evaluate(() => { localStorage.setItem(window.ShortcutsChangedModal.LOCAL_KEY, '1'); });
    await page.evaluate(() => window.NotificationBell.refreshAll());
    expect(await page.evaluate(() => window.DashboardKeysHelpRenamedNotice.shouldShow())).toBe(false);
    await page.evaluate(() => window.NotificationBell.open());
    await expect(row(page)).toHaveCount(0);
    // The same page as an existing install would get it: only the fresh install keeps it away.
    expect(await page.evaluate(() => { window.dashboardInstance.settings.firstRunInstall = false; return window.DashboardKeysHelpRenamedNotice.shouldShow(); })).toBe(true);
});
