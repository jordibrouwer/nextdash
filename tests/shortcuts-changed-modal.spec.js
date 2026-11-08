// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The window that says the keyboard shortcuts were reworked: once, for installs
 * that already existed, and not closable until it is acknowledged.
 */

const KEY = 'nextdash:shortcuts-changed-seen';
const panel = (page) => page.locator('#app-modal .shortcuts-changed-modal');

async function load(page, { fresh = false } = {}) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.ShortcutsChangedModal, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((isFresh) => {
        window.DiscoverabilityState.schedulePersist = () => {};
        window.dashboardInstance.settings.firstRunInstall = isFresh;
        localStorage.removeItem('nextdash:shortcuts-changed-seen');
        window.DiscoverabilityState.resetSettingPromoSeen('shortcuts-reworked-v1', { persist: false });
    }, fresh);
}

test('an existing install gets it, and it cannot be closed without the tick', async ({ page }) => {
    await load(page);
    await page.evaluate(() => window.ShortcutsChangedModal.ask());
    await expect(panel(page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toContainText('Your keyboard shortcuts have changed');
    await expect(panel(page)).toContainText('Shift+S');
    const continueBtn = page.locator('#modal-actions .modal-button').first();
    await expect(continueBtn).toBeDisabled();
    // Not by Escape, not by a click beside it, not by Enter on the disabled button.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeVisible();
    await page.locator('#app-modal').click({ position: { x: 4, y: 4 } });
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('#modal-esc-hint')).toHaveText('');
    // Tick, then Continue.
    await page.locator('#sc-changed-ack').check();
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('1');
    // Asked again, it stays away.
    await page.evaluate(() => window.ShortcutsChangedModal.ask());
    // Guards a check that the window stays away: longer than its own start delay.
    await page.waitForTimeout(1500);
    await expect(panel(page)).toHaveCount(0);
});

test('a fresh install never sees it, and counts as answered', async ({ page }) => {
    await load(page, { fresh: true });
    await page.evaluate(() => window.ShortcutsChangedModal.ask());
    // Guards a check that the window never opens: longer than its own start delay.
    await page.waitForTimeout(1500);
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('1');
});

test('another window replacing it does not count as answered: it comes back', async ({ page }) => {
    await load(page);
    await page.evaluate(() => window.ShortcutsChangedModal.ask());
    await expect(panel(page)).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.AppModal.show({ title: 'Other', message: 'x', showCancel: false }));
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
    await page.evaluate(() => window.AppModal.hide());
    await expect(panel(page)).toBeVisible({ timeout: 15_000 });
});

test('an arrow at the lower right says there is more to read, and goes at the end', async ({ page }) => {
    await load(page);
    await page.evaluate(() => window.ShortcutsChangedModal.ask());
    await expect(panel(page)).toBeVisible({ timeout: 15_000 });
    const more = page.locator('.sc-more-btn');
    await expect(more).toBeVisible();
    // It sits in the lower right of the text, not the left.
    const box = await page.locator('.sc-more-btn').boundingBox();
    const text = await page.locator('#app-modal .modal-text').boundingBox();
    expect(box && text && box.x > text.x + text.width / 2 && box.y > text.y + text.height / 2).toBe(true);
    await page.locator('.sc-more-btn').click();
    await expect.poll(() => page.evaluate(() => document.querySelector('#app-modal .modal-text').scrollTop)).toBeGreaterThan(100);
    await page.evaluate(() => { const s = document.querySelector('#app-modal .modal-text'); s.scrollTop = s.scrollHeight; });
    await expect(more).toBeHidden();
});
