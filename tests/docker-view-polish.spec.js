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

  // Uptime is how long a container has been up, not how old it is: an old
  // container that just restarted sorts below a young one that has not.
  test('sort by uptime follows the start time, stopped last', async ({ page }) => {
    const row = (name, extra) => ({ id: name.padEnd(64, '0'), shortId: name.padEnd(12, '0'), name, image: `x/${name}`, tag: 'latest',
      health: '', ports: [], ...extra });
    await mockDocker(page, { containers: [
      row('oldrestarted', { state: 'running', status: 'Up 5 minutes', created: 1700000000, startedAt: 1790000000 }),
      row('youngsteady', { state: 'running', status: 'Up 3 days', created: 1780000000, startedAt: 1789000000 }),
      row('ancientstopped', { state: 'exited', status: 'Exited (0) 1 day ago', created: 1600000000 }),
    ] });
    await page.goto('/#docker');
    await page.locator('[data-docker-group]').selectOption('none');
    await page.locator('[data-docker-sort]').selectOption('uptime');
    await expect(page.locator('[data-docker-row]')).toHaveCount(3);
    const names = await page.locator('[data-docker-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-docker-row')));
    expect(names).toEqual(['youngsteady', 'oldrestarted', 'ancientstopped']);
  });

  test('a column heading sorts, a second click turns it round, and a reload keeps it', async ({ page }) => {
    await openView(page);
    await page.locator('[data-docker-group]').selectOption('none');
    const rows = page.locator('[data-docker-row]');
    const names = () => rows.evaluateAll((els) => els.map((r) => r.getAttribute('data-docker-row')));
    const nameHead = page.locator('[data-docker-sort-head="name"]');
    const statusHead = page.locator('.docker-head--state');

    await page.locator('[data-docker-sort-head="state"]').click();
    await expect(page.locator('[data-docker-sort]')).toHaveValue('status');
    await expect(statusHead).toHaveAttribute('aria-sort', 'ascending');
    expect((await names()).at(-1)).toBe('bazarr');

    await nameHead.click();
    await expect(page.locator('.docker-head--name')).toHaveAttribute('aria-sort', 'ascending');
    await expect(statusHead).not.toHaveAttribute('aria-sort', /./);
    expect(await names()).toEqual(['bazarr', 'jellyfin', 'nextdash', 'sonarr']);

    // From the keyboard too: Enter on the focused heading sorts, and does
    // not open a row's drawer.
    await nameHead.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.docker-head--name')).toHaveAttribute('aria-sort', 'descending');
    await expect(nameHead).toBeFocused();
    await expect(page).not.toHaveURL(/#docker\//);
    expect(await names()).toEqual(['sonarr', 'nextdash', 'jellyfin', 'bazarr']);

    await page.reload();
    await expect(rows).toHaveCount(4);
    await expect(page.locator('.docker-head--name')).toHaveAttribute('aria-sort', 'descending');
    expect(await names()).toEqual(['sonarr', 'nextdash', 'jellyfin', 'bazarr']);

    // The toolbar picks a sort afresh, in its natural direction.
    await page.locator('[data-docker-sort]').selectOption('uptime');
    await page.locator('[data-docker-sort]').selectOption('name');
    await expect(page.locator('.docker-head--name')).toHaveAttribute('aria-sort', 'ascending');
  });

  test('CPU and RAM columns show the sampler\'s reading and sort highest first', async ({ page }) => {
    await openView(page, { usage: true });
    await page.locator('[data-docker-group]').selectOption('none');
    const heads = page.locator('.docker-table thead th');
    await expect(heads).toHaveText(['Name', 'Image', 'Status', 'CPU', 'RAM', 'Web UI', 'Ports']);
    const jellyfin = page.locator('[data-docker-row="jellyfin"]');
    await expect(jellyfin.locator('.docker-cell--cpu')).toHaveText('41.7 %');
    await expect(jellyfin.locator('.docker-cell--mem')).toHaveText('1.3 GiB');
    await expect(page.locator('[data-docker-row="bazarr"] .docker-cell--cpu')).toHaveText('—');

    const names = () => page.locator('[data-docker-row]').evaluateAll((els) => els.map((r) => r.getAttribute('data-docker-row')));
    await page.locator('[data-docker-sort-head="cpu"]').click();
    await expect(page.locator('.docker-head--cpu')).toHaveAttribute('aria-sort', 'descending');
    expect(await names()).toEqual(['jellyfin', 'sonarr', 'nextdash', 'bazarr']);
    // Turned round, the stopped one still has no reading and stays last.
    await page.locator('[data-docker-sort-head="cpu"]').click();
    expect(await names()).toEqual(['nextdash', 'sonarr', 'jellyfin', 'bazarr']);
    await page.locator('[data-docker-sort-head="mem"]').click();
    expect(await names()).toEqual(['jellyfin', 'sonarr', 'nextdash', 'bazarr']);
  });

  test('no CPU or RAM columns while the sampler is off', async ({ page }) => {
    await openView(page, { usage: false });
    await expect(page.locator('.docker-table thead th')).toHaveText(['Name', 'Image', 'Status', 'Web UI', 'Ports']);
    await expect(page.locator('.docker-cell--cpu')).toHaveCount(0);
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
    await page.locator('[data-docker-drawer] [data-slp-tab="logs"]').click();
    await expect.poll(() => tails).toContain('500');
  });
});
