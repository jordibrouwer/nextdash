// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The weekly digest's settings, on Config -> Monitoring -> Notifications.
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
        c.monitoringTab = 'notifications';
        return c.openConfigView('monitoring');
    });
    await page.waitForSelector('[data-behavior-field="digestEnabled"]', { timeout: 15_000 });
}

const saved = (page, field) => page.evaluate(async (f) => {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    return (await res.json())[f];
}, field);

test('the switch, the day and the hour are saved', async ({ page }) => {
    await openStatus(page);
    await expect(page.getByRole('heading', { name: /^Weekly digest/ })).toBeVisible();

    const toggle = page.locator('[data-behavior-field="digestEnabled"]').first();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(() => saved(page, 'digestEnabled')).toBe(false);
    await page.reload();
    await openStatus(page);
    await expect(page.locator('[data-behavior-field="digestEnabled"]').first()).not.toBeChecked();

    await page.locator('[data-behavior-field="digestWeekday"]').first().selectOption('5');
    await expect.poll(() => saved(page, 'digestWeekday')).toBe(5);
    await page.locator('[data-behavior-field="digestTime"]').first().selectOption('19:00');
    await expect.poll(() => saved(page, 'digestTime')).toBe('19:00');

    // Put it back for the specs that share this server.
    await page.locator('[data-behavior-field="digestEnabled"]').first().check();
    await expect.poll(() => saved(page, 'digestEnabled')).toBe(true);
});

test('the proof button sends one, and the card shows it', async ({ page, request }) => {
    const added = await request.post('/api/inbox', {
        data: { url: 'https://digest-config-e2e.example/' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(added.ok()).toBeTruthy();
    await openStatus(page);

    const sent = page.waitForResponse((res) => res.url().endsWith('/api/digest/test'));
    await page.locator('[data-config-action="sendDigest"]').click();
    expect((await sent).status()).toBe(200);
    await expect(page.locator('[data-config-action-status="sendDigest"]')).toContainText('Sent');

    await page.evaluate(() => window.localStorage.removeItem('nextdashDigestSeenAt'));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.settings && window.DigestNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const view = await page.evaluate(() => window.dashboardInstance.activeView);
    expect(view).toBe('bookmarks');
    await page.evaluate(() => {
        document.querySelectorAll('.quickstart-card:not(.digest-notice-card)').forEach((el) => el.remove());
    });
    expect(await page.evaluate(() => window.DigestNotice.render())).toBe(true);
    await expect(page.locator('.digest-notice-card')).toBeVisible();
});

test('Show opens the latest digest', async ({ page, request }) => {
    const added = await request.post('/api/inbox', {
        data: { url: 'https://digest-config-show.example/' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(added.ok()).toBeTruthy();
    expect((await request.post('/api/digest/test', { headers: { 'X-NextDash-Token': WRITE_TOKEN } })).status()).toBe(200);
    await openStatus(page);
    await page.locator('[data-config-action="showDigest"]').click();
    await expect(page.locator('.digest-modal .digest-window')).toBeVisible();
});
