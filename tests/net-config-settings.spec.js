// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Network checks on Config -> Monitoring -> Checks: the four settings and the
 * ICMP status block. The capabilities answer is stubbed where the state of
 * ICMP is the point; it is learned from a real ping, which a spec cannot rely on.
 */

const DEFAULTS = { netToolsEnabled: true, netToolsPing: 'auto', netToolsAllowCustomHost: false, netToolsMaxChecks: 200 };

const caps = (extra = {}) => ({
  enabled: true, icmp: 'unknown', pingMode: 'auto', allowCustomHost: false, maxChecks: 200, scheduled: 3, typesBuilt: ['ping', 'tcp'], ...extra,
});

async function stubCaps(page, answer) {
  await page.route('**/api/net/capabilities', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(answer),
  }));
}

async function openChecks(page) {
  await markWhatsNewSeen(page);
  await page.goto('/');
  await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const c = window.dashboardInstance.config;
    c.monitoringTab = 'checks';
    return c.openConfigView('monitoring');
  });
  await page.waitForSelector('[data-behavior-field="netToolsEnabled"]', { timeout: 15_000 });
}

const saved = (page) => page.evaluate(async () => (await fetch('/api/settings', { cache: 'no-store' })).json());

test.afterEach(async ({ page }) => {
  // The settings live in the data folder the dev server shares: put them back.
  await page.evaluate(async (defaults) => {
    const current = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    await (window.nextDashFetch || fetch)('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, ...defaults }),
    });
  }, DEFAULTS).catch(() => {});
});

test('the four settings are saved, and the rest of the settings are kept', async ({ page }) => {
  await stubCaps(page, caps());
  await openChecks(page);
  const before = await saved(page);

  await page.locator('[data-behavior-field="netToolsEnabled"]').first().uncheck();
  await expect.poll(async () => (await saved(page)).netToolsEnabled).toBe(false);

  await page.locator('[data-behavior-field="netToolsPing"]').first().selectOption('tcp-only');
  await expect.poll(async () => (await saved(page)).netToolsPing).toBe('tcp-only');

  await page.locator('[data-behavior-field="netToolsAllowCustomHost"]').first().check();
  await expect.poll(async () => (await saved(page)).netToolsAllowCustomHost).toBe(true);

  const max = page.locator('[data-behavior-field="netToolsMaxChecks"]').first();
  await max.fill('40');
  await max.blur();
  await expect.poll(async () => (await saved(page)).netToolsMaxChecks).toBe(40);

  const after = await saved(page);
  // Something the panel never touches is still what it was.
  expect(after.theme).toBe(before.theme);
  expect(after.language).toBe(before.language);
});

test('ICMP blocked is a status with the compose snippet, not a failure', async ({ page }) => {
  await stubCaps(page, caps({ icmp: 'blocked' }));
  await openChecks(page);
  const status = page.locator('[data-net-tools-status]');
  await expect(status.locator('[data-net-icmp-status="blocked"]')).toContainText('Blocked');
  await expect(status.locator('.net-error-code')).toContainText('net.ipv4.ping_group_range: "0 2147483647"');
  await expect(status.locator('[data-net-scheduled]')).toHaveText('3 of 200 checks scheduled');
});

test('ICMP that works shows no fix', async ({ page }) => {
  await stubCaps(page, caps({ icmp: 'ok' }));
  await openChecks(page);
  const status = page.locator('[data-net-tools-status]');
  await expect(status.locator('[data-net-icmp-status="ok"]')).toHaveText('Works');
  await expect(status.locator('.net-error')).toHaveCount(0);
});

test('ICMP not tried yet says so', async ({ page }) => {
  await stubCaps(page, caps({ icmp: 'unknown' }));
  await openChecks(page);
  const status = page.locator('[data-net-tools-status]');
  await expect(status.locator('[data-net-icmp-status="unknown"]')).toHaveText('Not tried yet');
  await expect(status.locator('.net-error')).toHaveCount(0);
});
