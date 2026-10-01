const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

const confirmDialog = (page) => page.locator('.modal[role="dialog"]');

async function openDisk(page, opts) {
  const state = await mockDocker(page, opts);
  await page.goto('/#docker/~disk');
  await expect(page.locator('[data-docker-disk]')).toBeVisible();
  return state;
}

test.describe('docker disk', () => {
  // Unraid keeps container data in host folders, not volumes: they are listed
  // with who mounts them where, and have no remove -- only Measure.
  // A measurement is one /system/df read that can take long on a large host;
  // the shared progress overlay says it is working, on open and on Refresh.
  test('measuring shows the progress overlay until the answer arrives', async ({ page }) => {
    await mockDocker(page);
    let release;
    const hold = () => new Promise((resolve) => { release = resolve; });
    let held = hold();
    await page.route('**/api/docker/disk', async (route) => {
      await held;
      await route.fallback();
    });
    const overlay = page.locator('#nextdash-progress-overlay');

    await page.goto('/#docker/~disk');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('progressbar')).toBeVisible();
    release();
    await expect(overlay).toBeHidden();
    await expect(page.locator('[data-docker-disk-tile="build-cache"]')).toContainText('300 MiB');

    held = hold();
    await page.locator('[data-docker-disk-refresh]').click();
    await expect(overlay).toBeVisible();
    release();
    await expect(overlay).toBeHidden();
  });

  test('bind mounts are listed by host folder, without a remove', async ({ page }) => {
    await openDisk(page);
    const media = page.locator('[data-docker-disk-bind="/mnt/user/media"]');
    await expect(media).toContainText('jellyfin → /media');
    await expect(media).toContainText('sonarr → /tv');
    await expect(page.locator('[data-docker-disk-bind]')).toHaveCount(2);
    await expect(page.locator('[data-docker-disk-bind] button:not([data-docker-bind-measure])')).toHaveCount(0);
  });

  test('no bind mounts, no section', async ({ page }) => {
    const state = await mockDocker(page);
    state.disk = { images: [], volumes: [], binds: [], totals: {} };
    await page.goto('/#docker/~disk');
    await expect(page.locator('[data-docker-disk]')).toBeVisible();
    await expect(page.locator('[data-docker-disk-tile="volumes"]')).toBeVisible();
    await expect(page.locator('[data-docker-disk-bind]')).toHaveCount(0);
    await expect(page.getByText('Bind mounts')).toHaveCount(0);
  });

  test('#docker/~disk opens the Disk tab: tiles, lists, and the rail totals', async ({ page }) => {
    await openDisk(page);
    await expect(page.locator('[data-docker-tab="disk"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-docker-row]')).toHaveCount(0);
    await expect(page.locator('[data-docker-search]')).toBeHidden();
    const dangling = page.locator('[data-docker-disk-tile="images-dangling"]');
    await expect(dangling).toContainText('398 MiB');
    await expect(dangling.locator('[data-docker-disk-warning]')).toContainText('sonarr');
    await expect(page.locator('[data-docker-disk-tile="build-cache"]')).toContainText('300 MiB');
    await expect(page.locator('[data-docker-disk-image]')).toHaveCount(3);
    await expect(page.locator('[data-docker-disk-image="sha256:old1234567890ab"]')).toContainText(/rollback for sonarr/i);
    await expect(page.locator('.lvs-summary')).toContainText('Reclaimable');

    // A container named "disk" is not the tab: the tab has its own address.
    await page.locator('[data-docker-tab="containers"]').click();
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await expect(page).toHaveURL(/#docker$/);
    await expect(page.locator('[data-docker-search]')).toBeVisible();
  });

  test('pruning asks first, saying which rollbacks it ends, then runs and measures again', async ({ page }) => {
    const state = await openDisk(page);
    const before = state.calls.filter((c) => c === 'GET /disk').length;
    await page.locator('[data-docker-prune="images-dangling"]').click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('sonarr');
    await dialog.getByRole('button', { name: /cancel/i }).click();
    expect(state.calls).not.toContain('POST /prune/images-dangling');

    await page.locator('[data-docker-prune="images-dangling"]').click();
    await confirmDialog(page).getByRole('button', { name: /remove/i }).click();
    await expect.poll(() => state.calls).toContain('POST /prune/images-dangling');
    await expect.poll(() => state.calls.filter((c) => c === 'GET /disk').length).toBeGreaterThan(before);
  });

  // A fixed word, not the volume's name: anonymous volumes are named by 64
  // random characters nobody wants to type.
  test('a volume goes only once "delete" is typed; one in use has no button', async ({ page }) => {
    const state = await openDisk(page);
    await expect(page.locator('[data-docker-volume-remove="arr_config"]')).toHaveCount(0);
    await page.locator('[data-docker-volume-remove="old_pgdata"]').click();
    const box = page.locator('[data-docker-volume-confirm]');
    await expect(box).toBeVisible();
    const go = box.locator('[data-docker-volume-confirm-go]');
    await expect(go).toBeDisabled();
    await box.locator('input').fill('old_pgdata');
    await expect(go).toBeDisabled();
    await box.locator('input').fill('delete');
    await expect(go).toBeEnabled();
    await go.click();
    await expect.poll(() => state.volumeDeletes).toEqual(['old_pgdata?confirm=old_pgdata']);
    await expect(box).toHaveCount(0);
  });

  test('an empty tile reads 0 B, not 0 KiB', async ({ page }) => {
    const state = await mockDocker(page);
    state.disk = { images: [], volumes: [], totals: { images: 0, imagesUnused: 0, imagesUnusedCount: 0, dangling: 0, danglingCount: 0,
      buildCache: 0, buildCacheCount: 0, volumes: 0, volumesUnused: 0, volumesUnusedCount: 0, reclaimable: 0 } };
    await page.goto('/#docker/~disk');
    await expect(page.locator('[data-docker-disk-tile="images-dangling"] .docker-disk-tile-value')).toHaveText('0 B');
  });

  test('read-only shows the sizes and no way to remove anything', async ({ page }) => {
    await openDisk(page, { control: false });
    await expect(page.locator('[data-docker-disk-tile="images-unused"]')).toContainText('777 MiB');
    await expect(page.locator('[data-docker-prune]')).toHaveCount(0);
    await expect(page.locator('[data-docker-volume-remove]')).toHaveCount(0);
  });
});

// Stopped containers: a tile with the count, and Remove stopped asks first,
// naming them, before one request removes them.
test('Remove stopped names the containers, asks, then removes them', async ({ page }) => {
  const state = await mockDocker(page);
  await page.goto('/#docker/~disk');
  const tile = page.locator('[data-docker-disk-tile="containers-stopped"]');
  await expect(tile).toContainText('1 stopped');
  await tile.locator('[data-docker-prune="containers-stopped"]').click();
  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toContainText('bazarr');
  await expect(dialog).toContainText('volumes and images stay');
  await dialog.getByRole('button', { name: /cancel/i }).click();
  expect(state.calls).not.toContain('POST /prune/containers-stopped');
  await tile.locator('[data-docker-prune="containers-stopped"]').click();
  await dialog.getByRole('button', { name: /^remove$/i }).click();
  await expect.poll(() => state.calls).toContain('POST /prune/containers-stopped');
});

// A bind mount's folder is measured on request, one at a time, and the row
// shows the size; without actions there is no button.
test('Measure counts a bind mount folder and shows its size', async ({ page }) => {
  const state = await mockDocker(page);
  await page.goto('/#docker/~disk');
  const row = page.locator('[data-docker-disk-bind="/mnt/user/media"]');
  await expect(row.locator('[data-docker-bind-size]')).toHaveText('—');
  await row.locator('[data-docker-bind-measure]').click();
  await expect(row.locator('[data-docker-bind-size]')).toHaveText('3.0 GiB');
  await expect(row.locator('[data-docker-bind-measure]')).toHaveText('Measure again');
  expect(state.measured).toEqual(['/mnt/user/media']);
});

test('read-only: no Measure button', async ({ page }) => {
  await mockDocker(page, { control: false });
  await page.goto('/#docker/~disk');
  await expect(page.locator('[data-docker-disk-bind]').first()).toBeVisible();
  await expect(page.locator('[data-docker-bind-measure]')).toHaveCount(0);
});
