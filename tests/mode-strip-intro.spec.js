// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time coach note that explains the mode strip, for fresh and existing
 * installs alike. The test setup marks it seen before every load (it stands
 * under the page name), so each test asks for it again.
 */

const KEY = 'nextdash:mode-strip-intro-seen';
const note = (page) => page.locator('.coach-note[data-coach-note="mode-strip-intro"]');

async function load(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.CoachNote, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.DiscoverabilityState.schedulePersist = () => {};
        window.dashboardInstance.settings.enableSessionTips = false;
        window.dashboardInstance.settings.showModeStrip = true;
    });
}

async function ask(page) {
    await page.evaluate((key) => {
        localStorage.removeItem(key);
        window.DiscoverabilityState.resetSettingPromoSeen('mode-strip-intro', { persist: false });
        window.CoachNote.schedule('mode-strip-intro');
    }, KEY);
}

test('the note points at the strip and stays until it is put away', async ({ page }) => {
    await load(page);
    await ask(page);
    await expect(note(page)).toBeVisible({ timeout: 15_000 });
    await expect(note(page)).toContainText('The mode strip');
    await expect(note(page)).toContainText('Shift+S');
    // Still there a while later: nobody has answered.
    await page.waitForTimeout(1500);
    await expect(note(page)).toBeVisible();
    await note(page).getByRole('button', { name: 'Got it' }).click();
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('1');
    // Asked again, it does not come back.
    await page.evaluate(() => window.CoachNote.schedule('mode-strip-intro'));
    await page.waitForTimeout(2500);
    await expect(note(page)).toHaveCount(0);
});

test('Turn it off switches the strip off and counts as answered', async ({ page }) => {
    await load(page);
    await ask(page);
    await expect(note(page)).toBeVisible({ timeout: 15_000 });
    await note(page).getByRole('button', { name: 'Turn it off' }).click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.showModeStrip)).toBe(false);
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('1');
    // Leave the stored value as the other specs expect it.
    await page.evaluate(async () => { await window.ModeStrip.toggle(); });
    expect(await page.evaluate(() => window.dashboardInstance.settings.showModeStrip)).toBe(true);
});

test('with the strip switched off the note is not asked', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { window.dashboardInstance.settings.showModeStrip = false; });
    await ask(page);
    await page.waitForTimeout(4500);
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});
