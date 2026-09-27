const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The panel's Health tab: a visual summary on top (score ring, state, reasons
 * as chips, the monitor's heartbeat), the details below as an accordion whose
 * heads each say their answer.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
const pane = (page) => drawer(page).locator('[data-bm-pane="health"]');
const acc = (page, name) => pane(page).locator(`[data-bm-acc="${name}"]`);

async function openHealthTab(page, name) {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
  await drawer(page).locator('[data-bm-tab-panel="health"]').click();
  await expect(pane(page)).toBeVisible();
}

test.describe('bookmark panel: the Health tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('nextdash.bm.healthAcc'); } catch {} });
  });

  test('a broken bookmark: ring, state and reasons on top, Why open below', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openHealthTab(page, bookmarks[0].name);
    const viz = pane(page).locator('.config-bm-health-viz');
    await expect(viz.locator('svg.config-bm-health-ring')).toContainText('25');
    await expect(viz.locator('.config-bm-health-state')).toContainText(/broken/i);
    await expect(viz.locator('.config-bm-health-chip')).toContainText(['HTTP 500']);
    for (const name of ['why', 'score', 'checking', 'expectations']) await expect(acc(page, name)).toHaveCount(1);
    await expect(acc(page, 'score').locator('summary')).toContainText('25');
    await expect(acc(page, 'why')).toHaveAttribute('open', '');
    await expect(acc(page, 'score')).not.toHaveAttribute('open', '');
  });

  test('a healthy bookmark opens with every section closed', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openHealthTab(page, bookmarks[2].name);
    await expect(pane(page).locator('[data-bm-acc][open]')).toHaveCount(0);
  });

  test('a section opened stays open on the next bookmark', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openHealthTab(page, bookmarks[2].name);
    await acc(page, 'score').locator('summary').click();
    await expect(acc(page, 'score')).toHaveAttribute('open', '');
    await openHealthTab(page, bookmarks[3].name);
    await expect(acc(page, 'score')).toHaveAttribute('open', '');
  });

  test('a monitored bookmark shows its heartbeat on top and a Monitor section', async ({ page }) => {
    const now = Date.now();
    const { bookmarks } = await openBookmarksWithHealth(page, (issues) => issues.map((issue, i) => (i === 0 ? {
      ...issue, monitor: true, checkStatus: true,
      monitorStats: { intervalMinutes: 5, uptime24h: { ratio: 0.9, samples: 10 }, heartbeat: [
        { state: 'up', from: now - 600000, to: now - 300000, up: 1, down: 0, avgMs: 100 },
        { state: 'down', from: now - 300000, to: now, up: 0, down: 1, avgMs: 0 },
      ], incidents: [], totalChecks: 10, lastSample: now },
    } : issue)), { view: 'library' });
    await openHealthTab(page, bookmarks[0].name);
    await expect(pane(page).locator('.config-bm-health-viz .health-monitor-strip, .config-bm-health-viz [class*="heartbeat"]').first()).toBeVisible();
    await expect(acc(page, 'monitor')).toHaveCount(1);
  });

  test('c opens Checking and puts focus on its choices', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
    await expect(drawer(page).locator('.health-view-score-panel')).toBeAttached();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('c');
    await expect(acc(page, 'checking')).toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-check-mode'))).toBe(true);
  });
});
