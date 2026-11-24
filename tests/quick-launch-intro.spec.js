// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time coach note that points at the Quick launch corner element. The test
 * setup marks it seen before every load (it stands over the top-right corner), so
 * each test asks for it again.
 */

const KEY = 'nextdash:quick-launch-intro-seen';
const ID = 'quick-launch-intro';
const note = (page) => page.locator(`.coach-note[data-coach-note="${ID}"]`);

async function load(page, width = 1500) {
    await page.setViewportSize({ width, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.CoachNote, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.DiscoverabilityState.schedulePersist = () => {};
        window.dashboardInstance.settings.enableSessionTips = false;
        window.dashboardInstance.settings.quickLaunchButton = true;
        window.QuickLaunch.sync();
    });
}

async function ask(page) {
    await page.evaluate(([key, id]) => {
        localStorage.removeItem(key);
        window.DiscoverabilityState.resetSettingPromoSeen(id, { persist: false });
        window.CoachNote.schedule(id);
    }, [KEY, ID]);
}

test('the note points at the corner element and stays until it is put away', async ({ page }) => {
    await load(page);
    await ask(page);
    await expect(note(page)).toBeVisible({ timeout: 15_000 });
    await expect(note(page)).toContainText('Quick launch');
    await expect(note(page)).toContainText('Shift+Q');
    await expect(note(page)).toContainText('Config → Appearance → Header');
    await expect(page.locator('#quick-launch-button')).toHaveClass(/coach-note-anchor-ring/);
    await page.waitForTimeout(1500);
    await expect(note(page)).toBeVisible();
    await note(page).getByRole('button', { name: 'Got it' }).click();
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('1');
    // Asked again, it does not come back.
    await page.evaluate((id) => window.CoachNote.schedule(id), ID);
    await page.waitForTimeout(2500);
    await expect(note(page)).toHaveCount(0);
});

test('Customize opens Config on the Header tab with the Quick launch group open, and counts as answered', async ({ page }) => {
    await load(page);
    await ask(page);
    await expect(note(page)).toBeVisible({ timeout: 15_000 });
    await note(page).getByRole('button', { name: 'Customize' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'config');
    const panel = page.locator('[data-fold-key="quick-launch"]');
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveClass(/is-folded/);
    await expect(panel.locator('[data-behavior-field="quickLaunchGesture"]')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('1');
});

test('without the corner element there is no note, and it is not counted as seen', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchButton = false; window.QuickLaunch.sync(); });
    await ask(page);
    await page.waitForTimeout(4500);
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test('in a narrow window the corner element is not drawn, so there is no note either', async ({ page }) => {
    await load(page, 900);
    await ask(page);
    await page.waitForTimeout(4500);
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});
