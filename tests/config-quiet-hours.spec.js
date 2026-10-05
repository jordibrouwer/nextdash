// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Quiet hours and reminders, on Config -> Behavior -> Status & alerts.
 */

async function openStatus(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        (c.behaviorTab = c.behaviorTab || 'general', c).openConfigView('behavior');
        c.behaviorTab = 'status';
        c.render();
    });
    await page.waitForSelector('[data-behavior-field="quietHoursEnabled"]', { timeout: 15_000 });
}

const saved = (page, field) => page.evaluate(async (f) => {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    return (await res.json())[f];
}, field);

test('the switch, a window and the always-let-through kinds are saved', async ({ page }) => {
    await openStatus(page);

    await page.locator('[data-behavior-field="quietHoursEnabled"]').first().check();
    await expect.poll(() => saved(page, 'quietHoursEnabled')).toBe(true);

    await page.locator('[data-maint-list][data-maint-field="quietHours"] [data-maint-add]').click();
    await expect.poll(async () => (await saved(page, 'quietHours'))?.length).toBe(1);
    const win = (await saved(page, 'quietHours'))[0];
    expect(win.start).toBe('02:00');
    // The maintenance windows are a different list and stay untouched.
    expect((await saved(page, 'maintenanceWindows')) || []).toHaveLength(0);

    await page.locator('[data-quiet-allow="container-crash"]').check();
    await expect.poll(() => saved(page, 'quietHoursAllow')).toContain('container-crash');
    await page.locator('[data-quiet-allow="cert-expired"]').uncheck();
    await expect.poll(() => saved(page, 'quietHoursAllow')).not.toContain('cert-expired');

    // Put it back for the specs that share this server.
    await page.locator('[data-behavior-field="quietHoursEnabled"]').first().uncheck();
    await expect.poll(() => saved(page, 'quietHoursEnabled')).toBe(false);
});

test('the status line says whether the hours are open', async ({ page }) => {
    await openStatus(page);
    await expect(page.locator('[data-quiet-status]')).toContainText(/Quiet hours are off|Not quiet now|Quiet now/, { timeout: 10_000 });
});

test('reminders save their interval and their limit', async ({ page }) => {
    await openStatus(page);
    await page.locator('[data-behavior-field="remindersEnabled"]').first().check();
    await expect.poll(() => saved(page, 'remindersEnabled')).toBe(true);
    await page.locator('[data-behavior-field="remindAfterMinutes"]').first().selectOption('30');
    await expect.poll(() => saved(page, 'remindAfterMinutes')).toBe(30);
    await page.locator('[data-behavior-field="remindMax"]').first().selectOption('5');
    await expect.poll(() => saved(page, 'remindMax')).toBe(5);
    await page.locator('[data-behavior-field="remindersEnabled"]').first().uncheck();
});
