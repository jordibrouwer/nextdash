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
const toast = (page) => page.locator('#app-notification.show');
const row = (page) => page.locator('.notification-bell-row[data-bell-id="docker-update-notice"]');

async function openBell(page) {
  await page.evaluate(() => window.NotificationBell.refreshAll());
  await page.evaluate(() => window.NotificationBell.open());
}

async function load(page, { socket = true, opens = 3, settings = {} } = {}) {
  await mockDocker(page, { socket });
  await markWhatsNewSeen(page);
  await page.addInitScript((n) => {
    try { localStorage.setItem('nextdashDockerViewOpens', String(n - 1)); } catch { /* none */ }
  }, opens);
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.evaluate(({ id, settings }) => {
    const d = window.dashboardInstance;
    // Marks written by these tests must not reach the ./data the dev server shares.
    window.DiscoverabilityState.schedulePersist = () => {};
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
  test('it is a tip in the bell on the third visit, with no toast and no corner card', async ({ page }) => {
    await load(page, { opens: 3 });
    await openView(page);
    await openBell(page);
    await expect(row(page)).toBeVisible();
    await expect(row(page)).toContainText('Check images for updates?');
    await expect(row(page)).toContainText('Config → Containers → Updates');
    await expect(page.locator('.notification-bell-group[data-bell-group="tips"]')).toContainText('Check images for updates?');
    await expect(toast(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
  });

  test('not before the third visit', async ({ page }) => {
    await load(page, { opens: 2 });
    await openView(page);
    expect(await page.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(false);
    await openBell(page);
    await expect(row(page)).toHaveCount(0);
  });

  test('not without a linked socket, with checks on, or with the setting off', async ({ page }) => {
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
    // The row is in the bell in every view, not only the Containers view.
    await other.evaluate(() => window.dashboardInstance.docker.closeDockerView());
    expect(await other.evaluate(() => window.DashboardDockerUpdateNotice.shouldShow())).toBe(true);
    await other.close();
  });

  test('Mark read lets it go for good and changes nothing', async ({ page }) => {
    await load(page);
    await openView(page);
    await openBell(page);
    await row(page).getByRole('button', { name: 'Mark read' }).click();
    await expect(row(page)).toHaveCount(0);
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await expect(row(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.dashboardInstance.settings.dockerUpdateInterval)).toBe('off');
  });

  test('Turn on (daily) switches the check on and reads the row', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { window.dashboardInstance.saveSettings = async () => true; });
    await openView(page);
    await openBell(page);
    await row(page).getByRole('button', { name: 'Turn on (daily)' }).click();
    await expect(row(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.dashboardInstance.settings.dockerUpdateInterval)).toBe('24h');
    expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('docker-update-offer-v1'))).toBe(true);
  });
});
