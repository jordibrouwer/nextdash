const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

// The drawer is a dialog as well; confirmations are the app modal.
const confirmDialog = (page) => page.locator('.modal[role="dialog"]');

async function openView(page, opts) {
  const state = await mockDocker(page, opts);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  return state;
}

test.describe('docker view actions', () => {
  test('s stops a running container without a dialog', async ({ page }) => {
    const state = await openView(page);
    await page.locator('[data-docker-row="jellyfin"]').click();
    await page.keyboard.press('s');
    await expect.poll(() => state.calls).toContain('POST /containers/jellyfin/stop');
    await expect(page.locator('[data-docker-row="jellyfin"]')).toHaveAttribute('data-state', 'exited');
    await expect(confirmDialog(page)).toBeHidden();
  });

  test('s stops a restarting container, as its menu says', async ({ page }) => {
    const state = await mockDocker(page);
    state.containers.find((c) => c.name === 'jellyfin').state = 'restarting';
    await page.goto('/#docker');
    await page.locator('[data-docker-row="jellyfin"]').click();
    await page.keyboard.press('s');
    await expect.poll(() => state.calls).toContain('POST /containers/jellyfin/stop');
  });

  test('remove asks first and says volumes stay', async ({ page }) => {
    const state = await openView(page);
    await page.locator('[data-docker-row="bazarr"]').click();
    await page.keyboard.press('Delete');
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText(/volumes and image stay/i);
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
    expect(state.calls.some((c) => c.endsWith('/remove'))).toBe(false);
    await page.locator('[data-docker-row="bazarr"]').click();
    await page.keyboard.press('Delete');
    await confirmDialog(page).getByRole('button', { name: /^remove$/i }).click();
    await expect(page.locator('[data-docker-row="bazarr"]')).toHaveCount(0);
  });

  test('update confirms, then clears the badge', async ({ page }) => {
    const state = await openView(page);
    await page.locator('[data-docker-row="sonarr"]').click();
    await page.keyboard.press('u');
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('sonarr');
    await dialog.getByRole('button', { name: /^update$/i }).click();
    await expect.poll(() => state.calls).toContain('POST /containers/sonarr/update');
    await expect(page.locator('[data-docker-row="sonarr"] [data-docker-update-badge]')).toHaveCount(0);
  });

  test('drawer buttons follow the state', async ({ page }) => {
    const state = await openView(page);
    await page.locator('[data-docker-row="jellyfin"]').click();
    // Restart and Update sit beside Open web UI; the rest under ⋯.
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer.locator('[data-docker-drawer-actions] [data-docker-action="restart"]')).toBeVisible();
    await drawer.locator('[data-slp-more]').click();
    await expect(drawer.locator('[data-docker-drawer-more] [data-docker-action="stop"]')).toBeVisible();
    await expect(drawer.locator('[data-docker-action="start"]')).toHaveCount(0);
    await drawer.locator('[data-docker-drawer-more] [data-docker-action="stop"]').click();
    await expect.poll(() => state.calls).toContain('POST /containers/jellyfin/stop');
    await expect(drawer.locator('[data-docker-action="start"]')).toHaveCount(1);
  });

  test('own container offers no actions', async ({ page }) => {
    const state = await openView(page);
    await page.locator('[data-docker-row="nextdash"]').click();
    await expect(page.locator('[data-docker-drawer]')).toContainText(/runs nextDash/i);
    await expect(page.locator('[data-docker-drawer-actions] button')).toHaveCount(0);
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    expect(state.calls.some((c) => c.startsWith('POST /containers'))).toBe(false);
  });

  test('read-only offers no actions and keys do nothing', async ({ page }) => {
    const state = await openView(page, { control: false });
    await page.locator('[data-docker-row="jellyfin"]').click();
    await expect(page.locator('[data-docker-drawer-actions] button')).toHaveCount(0);
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    expect(state.calls.some((c) => c.startsWith('POST /containers'))).toBe(false);
    // The legend stays, without the keys that act on Docker.
    await expect(page.locator('.docker-legend kbd', { hasText: /^s$/ })).toHaveCount(0);
  });

  test('bulk restart from multi-select', async ({ page }) => {
    const state = await openView(page);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('[data-docker-row="sonarr"]').click();
    await page.locator('[data-docker-row="jellyfin"]').click({ modifiers: [mod] });
    const bulk = page.locator('[data-docker-bulk]');
    await expect(bulk).toContainText('2');
    await bulk.locator('[data-docker-bulk-action="restart"]').click();
    await expect.poll(() => state.calls.filter((c) => c.endsWith('/restart')).length).toBe(2);
  });

  test('a project group row starts, stops and restarts its stack', async ({ page }) => {
    const row = (name, project, state) => ({ id: name.padEnd(64, '0'), shortId: name.padEnd(12, '0'), name, image: `x/${name}`,
      tag: 'latest', state, status: state === 'running' ? 'Up 2 days' : 'Exited (0) 1 hour ago', health: '', created: 1790000000,
      ports: [], composeProject: project });
    const state = await mockDocker(page, { containers: [
      row('sonarr', 'arr', 'running'), row('radarr', 'arr', 'running'),
      row('jellyfin', 'media', 'running'), row('jellyseerr', 'media', 'exited'),
      row('bazarr', '', 'exited'),
    ] });
    await page.goto('/#docker');
    await page.locator('[data-docker-group]').selectOption('project');
    const arr = page.locator('.docker-group-row[data-docker-group-project="arr"]');
    await expect(arr.locator('[data-docker-stack-action="start"]')).toBeDisabled();
    await expect(page.locator('.docker-group-row[data-docker-group-project="media"] [data-docker-stack-action="start"]')).toBeEnabled();
    // No project is not a stack.
    await expect(page.locator('.docker-group-row').last().locator('[data-docker-stack-action]')).toHaveCount(0);

    // Enter on a focused stack button runs it, not the selected row's drawer.
    await arr.locator('[data-docker-stack-action="stop"]').focus();
    await page.keyboard.press('Enter');
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('sonarr');
    await expect(dialog).toContainText('radarr');
    await expect(page).not.toHaveURL(/#docker\//);
    await dialog.getByRole('button', { name: /^stop$/i }).click();
    await expect.poll(() => state.calls.filter((c) => c.endsWith('/stop')).sort())
      .toEqual(['POST /containers/radarr/stop', 'POST /containers/sonarr/stop']);
  });

  // Update on a project's row takes only what has an update waiting: not a
  // skipped or held version, not an image nobody checked.
  test('a project group row updates what in its stack has an update waiting', async ({ page }) => {
    const row = (name, project, update) => ({ id: name.padEnd(64, '0'), shortId: name.padEnd(12, '0'), name, image: `x/${name}`,
      tag: 'latest', state: 'running', status: 'Up 2 days', health: '', created: 1790000000, ports: [], composeProject: project,
      ...(update ? { update } : {}) });
    const state = await mockDocker(page, { containers: [
      row('sonarr', 'arr', { status: 'available' }), row('radarr', 'arr', { status: 'available' }),
      row('lidarr', 'arr', { status: 'skipped', skippedDigest: 'sha256:x' }), row('prowlarr', 'arr', { status: 'current' }),
      row('jellyfin', 'media', { status: 'held', held: true }), row('jellyseerr', 'media', null),
    ] });
    await page.goto('/#docker');
    await page.locator('[data-docker-group]').selectOption('project');
    const arr = page.locator('.docker-group-row[data-docker-group-project="arr"] [data-docker-stack-action="update"]');
    const media = page.locator('.docker-group-row[data-docker-group-project="media"] [data-docker-stack-action="update"]');
    await expect(arr).toHaveText(/\(2\)/);
    await expect(arr).toBeEnabled();
    await expect(media).toBeDisabled();

    await arr.click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('radarr');
    await expect(dialog).not.toContainText('lidarr');
    await expect(dialog).not.toContainText('prowlarr');
    await dialog.getByRole('button', { name: /cancel/i }).click();
    expect(state.calls.filter((c) => c.endsWith('/update'))).toEqual([]);

    await arr.click();
    await confirmDialog(page).getByRole('button', { name: /^update$/i }).click();
    await expect.poll(() => state.calls.filter((c) => c.endsWith('/update')).sort())
      .toEqual(['POST /containers/radarr/update', 'POST /containers/sonarr/update']);
  });

  test('read-only shows no stack buttons', async ({ page }) => {
    await openView(page, { control: false });
    await page.locator('[data-docker-group]').selectOption('project');
    await expect(page.locator('.docker-group-row')).not.toHaveCount(0);
    await expect(page.locator('[data-docker-stack-action]')).toHaveCount(0);
  });

  test('a refused action says why', async ({ page }) => {
    const state = await openView(page);
    state.control = false; // the setting changed under the open page
    await page.locator('[data-docker-row="jellyfin"]').click();
    await page.locator('[data-docker-drawer] [data-slp-more]').click();
    await page.locator('[data-docker-drawer-more] [data-docker-action="stop"]').click();
    await expect(page.locator('[data-docker-readonly]')).toBeVisible();
  });

  test('legend lists the keys', async ({ page }) => {
    await openView(page);
    await expect(page.locator('.docker-legend kbd')).toContainText(['s', 'r', 'p', 'u']);
  });
});
