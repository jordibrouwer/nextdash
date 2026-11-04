// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The keyboard tips and the home-screen hint wait in the bell (group Tips)
 * until they are read; neither is a toast any more.
 */

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.DashboardKeyboardTip && window.PwaInstallHint, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // Marks written here must not reach the ./data the dev server shares.
        window.DiscoverabilityState.schedulePersist = () => {};
        window.DiscoverabilityState.clearSeenTips({ persist: false });
        try { localStorage.removeItem('nextdash-keyboard-tip-current'); } catch { /* none */ }
        window.dashboardInstance.settings.enableSessionTips = true;
        window.__toasts = 0;
        window.dashboardInstance.showNotification = () => { window.__toasts += 1; };
        window.AppNotification?.show && (window.AppNotification.show = () => { window.__toasts += 1; });
    });
}

const tipRow = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);
const tick = (page) => page.evaluate(() => window.DashboardKeyboardTip.tick());
const openBell = async (page) => {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
};

test.describe('keyboard tips in the bell', () => {
    test('one tip waits in the group Tips, as plain text, with no toast', async ({ page }) => {
        await load(page);
        const id = await tick(page);
        expect(id).toBeTruthy();
        await openBell(page);
        const row = tipRow(page, `keyboard-tip:${id}`);
        await expect(row).toBeVisible();
        await expect(page.locator('.notification-bell-group[data-bell-group="tips"]')).toContainText('Mark read');
        await expect(row.locator('.notification-bell-row-label')).not.toContainText('<code>');
        await expect(page.locator('.notification-bell-row[data-bell-id^="keyboard-tip:"]')).toHaveCount(1);
        expect(await page.evaluate(() => window.__toasts)).toBe(0);
        // A second look keeps the same tip.
        expect(await tick(page)).toBe(id);
    });

    test('a read tip is gone, counts as seen, and the next waits for the 24 hours', async ({ page }) => {
        await load(page);
        const id = await tick(page);
        await openBell(page);
        await tipRow(page, `keyboard-tip:${id}`).getByRole('button', { name: 'Mark read' }).click();
        await expect(tipRow(page, `keyboard-tip:${id}`)).toHaveCount(0);

        // The next look settles it: seen, and the day's allowance is used.
        expect(await tick(page)).toBeNull();
        expect(await page.evaluate((t) => window.DiscoverabilityState.hasSeenTip(t), id)).toBe(true);
        expect(await page.evaluate(() => window.DiscoverabilityState.tipsAllowedNow())).toBe(false);
        await expect(page.locator('.notification-bell-row[data-bell-id^="keyboard-tip:"]')).toHaveCount(0);

        // Allowed again: a different tip comes.
        await page.evaluate(() => { window.DiscoverabilityState.tipsAllowedNow = () => true; });
        const next = await tick(page);
        expect(next).toBeTruthy();
        expect(next).not.toBe(id);
        await openBell(page);
        await expect(tipRow(page, `keyboard-tip:${next}`)).toBeVisible();
    });

    test('with the Config toggle off there is no row', async ({ page }) => {
        await load(page);
        await page.evaluate(() => { window.dashboardInstance.settings.enableSessionTips = false; });
        expect(await tick(page)).toBeNull();
        await openBell(page);
        await expect(page.locator('.notification-bell-row[data-bell-id^="keyboard-tip:"]')).toHaveCount(0);
    });
});

test.describe('the home-screen hint in the bell', () => {
    async function onAPhone(page) {
        await page.evaluate(() => {
            window.MobileExperience.isMobileLayout = () => true;
            window.MobileExperience.shouldShowDiscoverabilityUi = () => true;
            window.dashboardInstance.settings.onboardingCompleted = true;
            try { localStorage.removeItem('nextdash-pwa-install-hint-v1'); } catch { /* none */ }
            window.__prompted = 0;
            const event = new Event('beforeinstallprompt', { cancelable: true });
            Object.assign(event, { prompt: async () => { window.__prompted += 1; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
            window.dispatchEvent(event);
        });
    }

    test('it is a tip row with an Install button and no toast', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        const row = tipRow(page, 'pwa-install-hint');
        await expect(row).toBeVisible();
        await expect(row).toContainText('home screen');
        expect(await page.evaluate(() => window.__toasts)).toBe(0);
        await row.getByRole('button', { name: 'Install' }).click();
        await expect(row).toHaveCount(0);
        expect(await page.evaluate(() => window.__prompted)).toBe(1);
    });

    test('Mark read lets it go for good', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        await tipRow(page, 'pwa-install-hint').getByRole('button', { name: 'Mark read' }).click();
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
    });

    test('not on a desktop layout', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => { window.MobileExperience.isMobileLayout = () => false; });
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
    });
});
