// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The Containers view offers the daily image-update check, once, after the
 * third visit, and only to someone whose Docker socket is linked.
 */
const PROMO_ID = 'docker-update-offer-v1';
const card = (page) => page.locator('.docker-update-notice-card');

async function load(page, { socket = true, opens = 3, settings = {} } = {}) {
  await mockDocker(page, { socket });
  await markWhatsNewSeen(page);
  await page.addInitScript((n) => {
    try { localStorage.setItem('nextdashDockerViewOpens', String(n - 1)); localStorage.removeItem('nextdashDockerUpdateOfferSnoozeUntil'); } catch { /* none */ }
  }, opens);
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.evaluate(({ id, settings }) => {
    const d = window.dashboardInstance;
    window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
    d.settings.quickStart = { ...(d.settings.quickStart || {}), analyticsChoiceMade: true };
    Object.assign(d.settings, { dockerViewEnabled: true, dockerUpdateInterval: 'off', enableDockerUpdateNotice: true }, settings);
    document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
  }, { id: PROMO_ID, settings });
}

// Opens the view through its real entry point (counts as one visit).
async function openView(page) {
  await page.evaluate(() => window.dashboardInstance.docker.openDockerView());
  await expect(page.locator('[data-docker-row]').first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
}

test.describe('the image-update invitation', () => {
  test('it appears in the Containers view on the third visit', async ({ page }) => {
    await load(page, { opens: 3 });
    await openView(page);
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toContainText('Check images for updates?');
  });

  test('not before the third visit', async ({ page }) => {
    await load(page, { opens: 2 });
    await openView(page);
    expect(await page.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
    await expect(card(page)).toHaveCount(0);
  });

  test('not without a linked socket, with checks on, with the setting off, or in the dashboard view', async ({ page }) => {
    await load(page, { socket: false });
    await openView(page);
    expect(await page.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);

    const other = await page.context().newPage();
    await load(other, { settings: { dockerUpdateInterval: '24h' } });
    await openView(other);
    expect(await other.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
    await other.evaluate(() => { window.dashboardInstance.settings.dockerUpdateInterval = 'off'; window.dashboardInstance.settings.enableDockerUpdateNotice = false; });
    expect(await other.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
    await other.evaluate(() => { window.dashboardInstance.settings.enableDockerUpdateNotice = true; });
    expect(await other.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(true);
    // Back in the bookmarks view the corner stays clear.
    await other.evaluate(() => window.dashboardInstance.docker.closeDockerView());
    expect(await other.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
    await other.close();
  });

  test('Turn on writes 24h, and only then', async ({ page }) => {
    await load(page);
    const before = await page.evaluate(() => fetch('/api/settings').then((r) => r.json()));
    try {
      await openView(page);
      await expect(card(page)).toBeVisible({ timeout: 15_000 });
      const during = await page.evaluate(() => fetch('/api/settings').then((r) => r.json()));
      expect(during.dockerUpdateInterval).toBe(before.dockerUpdateInterval);
      await card(page).locator('[data-du-action="enable"]').click();
      await expect(card(page)).toHaveCount(0);
      await expect.poll(async () => (await page.evaluate(() => fetch('/api/settings').then((r) => r.json()))).dockerUpdateInterval).toBe('24h');
      expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('docker-update-offer-v1'))).toBe(true);
    } finally {
      await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.dockerUpdateInterval = 'off';
        await d.saveSettings();
      });
    }
  });

  test('Not now hides it and snoozes it', async ({ page }) => {
    await load(page);
    await openView(page);
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await card(page).locator('[data-du-action="later"]').click();
    await expect(card(page)).toHaveCount(0);
    expect(await page.evaluate(() => Number(localStorage.getItem('nextdashDockerUpdateOfferSnoozeUntil')) > Date.now())).toBe(true);
    expect(await page.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
    expect(await page.evaluate(() => window.dashboardInstance.settings.dockerUpdateInterval)).toBe('off');
  });

  test('Never keeps it away for good', async ({ page }) => {
    await load(page);
    await openView(page);
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await card(page).locator('[data-du-action="never"]').click();
    await expect(card(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('docker-update-offer-v1'))).toBe(true);
    expect(await page.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
  });
});
