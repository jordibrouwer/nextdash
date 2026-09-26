const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markInboxTutorialSeen, markWhatsNewSeen } = require('./e2e-helpers');

async function openView(page, opts) {
  const state = await mockDocker(page, opts);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  return state;
}

test.describe('docker view polish', () => {
  test('right-click opens a menu whose actions run', async ({ page }) => {
    const state = await openView(page);
    await page.locator('[data-docker-row="jellyfin"]').click({ button: 'right' });
    const menu = page.locator('#docker-row-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('jellyfin');
    await expect(menu.locator('[data-docker-menu-action="stop"]')).toBeVisible();
    await menu.locator('[data-docker-menu-action="restart"]').click();
    await expect(menu).toHaveCount(0);
    await expect.poll(() => state.calls).toContain('POST /containers/jellyfin/restart');
  });

  test('menu: Escape closes, Details opens the drawer', async ({ page }) => {
    await openView(page);
    await page.locator('[data-docker-row="bazarr"]').click({ button: 'right' });
    await expect(page.locator('#docker-row-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#docker-row-menu')).toHaveCount(0);
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.locator('[data-docker-row="bazarr"]').click({ button: 'right' });
    await page.locator('[data-docker-menu-action="open"]').click();
    await expect(page.locator('[data-docker-drawer]')).toContainText('bazarr');
  });

  test('rows carry their status and the own container is marked', async ({ page }) => {
    await openView(page);
    await expect(page.locator('[data-docker-row="sonarr"]')).toHaveAttribute('data-docker-status', 'updates');
    await expect(page.locator('[data-docker-row="jellyfin"]')).toHaveAttribute('data-docker-status', 'running');
    await expect(page.locator('[data-docker-row="bazarr"]')).toHaveAttribute('data-docker-status', 'stopped');
    await expect(page.locator('[data-docker-row="nextdash"]')).toHaveAttribute('data-docker-self', '');
    await expect(page.locator('[data-docker-row="jellyfin"]')).not.toHaveAttribute('data-docker-self', '');
  });

  test('group by status', async ({ page }) => {
    await openView(page);
    await page.locator('[data-docker-group]').selectOption('status');
    await expect(page.locator('.docker-group-row')).toHaveText(['Updates', 'Running', 'Stopped']);
  });

  test('rail summary is filled', async ({ page }) => {
    await openView(page);
    await expect(page.locator('.lvs-summary [data-lvs-summary-key="running"]')).toContainText('3 / 4');
    await expect(page.locator('.lvs-summary [data-lvs-summary-key="updates"]')).toContainText('1');
  });

  test('page title says containers', async ({ page }) => {
    await openView(page);
    await expect(page.locator('.title').first()).toContainText(/containers/i);
  });

  test('check for updates shows progress and its outcome', async ({ page }) => {
    await openView(page);
    await page.locator('[data-docker-check]').click();
    await expect(page.locator('#nextdash-progress-overlay')).toContainText(/up to date|updates available/i);
  });

  test('leaving the view takes the drawer down', async ({ page }) => {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await openView(page);
    await page.locator('[data-docker-row="jellyfin"]').click();
    await expect(page.locator('[data-docker-drawer]')).toBeVisible();
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('[data-docker-drawer]')).toHaveCount(0);
  });

  test('update badge goes without a reload', async ({ page }) => {
    await openView(page);
    await page.locator('[data-docker-row="sonarr"]').click({ button: 'right' });
    await page.locator('[data-docker-menu-action="update"]').click();
    await page.locator('.modal[role="dialog"]').getByRole('button', { name: /^update$/i }).click();
    await expect(page.locator('[data-docker-row="sonarr"] [data-docker-update-badge]')).toHaveCount(0);
    await expect(page.locator('[data-docker-row="sonarr"]')).toHaveAttribute('data-docker-status', 'running');
  });
});

test.describe('docker view follows Config -> Containers', () => {
  test('confirm stop when asked to', async ({ page }) => {
    const state = await mockDocker(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    // Client-side only: the e2e data dir is shared, so nothing is saved.
    await page.evaluate(() => { window.dashboardInstance.settings.dockerConfirmStopRestart = true; });
    await page.locator('[data-docker-row="jellyfin"]').click();
    await page.keyboard.press('s');
    const dialog = page.locator('.modal[role="dialog"]');
    await expect(dialog).toContainText('jellyfin');
    await dialog.getByRole('button', { name: /cancel/i }).click();
    expect(state.calls.some((c) => c.endsWith('/stop'))).toBe(false);
  });

  test('logs ask for the configured number of lines', async ({ page }) => {
    await mockDocker(page);
    const tails = [];
    page.on('request', (r) => { const m = r.url().match(/\/logs\?tail=(\d+)/); if (m) tails.push(m[1]); });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.evaluate(() => { window.dashboardInstance.settings.dockerLogLines = 500; });
    await page.locator('[data-docker-row="sonarr"]').click();
    const logs = page.locator('[data-docker-section="logs"]');
    if (!(await logs.evaluate((d) => d.open))) await logs.locator('summary').click();
    await expect.poll(() => tails).toContain('500');
  });
});
