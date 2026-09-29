const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

const confirmDialog = (page) => page.locator('.modal[role="dialog"]');

// sonarr has an update on offer, and a history: last updated from 4.0.9 to
// 4.0.10, which it can still roll back.
function withHistory(state) {
  const sonarr = state.containers.find((c) => c.name === 'sonarr');
  sonarr.updateHistory = [
    { at: Date.parse('2026-09-28T09:00:00Z'), kind: 'update', container: 'sonarr', image: sonarr.image,
      fromImageId: 'sha256:aaaaaaaaaaaa1111', toImageId: 'sha256:bbbbbbbbbbbb2222', fromVersion: '4.0.9', toVersion: '4.0.10' },
  ];
  sonarr.rollback = { at: sonarr.updateHistory[0].at, toImageId: 'sha256:aaaaaaaaaaaa1111', toVersion: '4.0.9', fromVersion: '4.0.10' };
}

async function openUpdates(page, opts) {
  const state = await mockDocker(page, opts);
  withHistory(state);
  await page.goto('/#docker/sonarr');
  const section = page.locator('[data-docker-drawer] [data-docker-section="updates"]');
  await section.locator('summary').click();
  await expect(section.locator('[data-docker-updates-status]')).not.toBeEmpty();
  return { state, section };
}

test.describe('docker updates: skip, hold, history and rollback', () => {
  test('skipping the version on offer drops the badge; Undo brings it back', async ({ page }) => {
    const { state, section } = await openUpdates(page);
    const row = page.locator('[data-docker-row="sonarr"]');
    await expect(row.locator('[data-docker-update-badge]')).toHaveCount(1);

    await section.locator('[data-docker-update-choice="skip"]').click();
    await expect.poll(() => state.choices).toEqual([{ image: 'lscr.io/linuxserver/sonarr:latest', choice: 'skip' }]);
    await expect(row.locator('[data-docker-update-badge]')).toHaveCount(0);
    await expect(section.locator('[data-docker-updates-status]')).toContainText(/skipped/i);

    await section.locator('[data-docker-update-choice="unskip"]').click();
    await expect(row.locator('[data-docker-update-badge]')).toHaveCount(1);
  });

  test('holding updates marks the row held; Resume lifts it', async ({ page }) => {
    const { section } = await openUpdates(page);
    const row = page.locator('[data-docker-row="sonarr"]');
    await section.locator('[data-docker-update-choice="hold"]').click();
    await expect(row.locator('[data-docker-held-badge]')).toHaveCount(1);
    await expect(row.locator('[data-docker-update-badge]')).toHaveCount(0);
    await expect(section.locator('[data-docker-updates-status]')).toContainText(/held/i);
    await section.locator('[data-docker-update-choice="unhold"]').click();
    await expect(row.locator('[data-docker-held-badge]')).toHaveCount(0);
  });

  test('the history lists the update, and Roll back asks first, then runs', async ({ page }) => {
    const { state, section } = await openUpdates(page);
    await expect(section.locator('[data-docker-update-history] li')).toHaveCount(1);
    await expect(section.locator('[data-docker-update-history] li').first()).toContainText('4.0.9 → 4.0.10');

    const rollback = section.locator('[data-docker-rollback]');
    await expect(rollback).toContainText('4.0.9');
    await rollback.click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('4.0.9');
    await dialog.getByRole('button', { name: /cancel/i }).click();
    expect(state.calls).not.toContain('POST /containers/sonarr/rollback');

    await rollback.click();
    await confirmDialog(page).getByRole('button', { name: /roll back/i }).click();
    await expect.poll(() => state.calls).toContain('POST /containers/sonarr/rollback');
  });

  test('a rollback that had to be undone says so as a rollback', async ({ page }) => {
    const { section } = await openUpdates(page);
    await page.route('**/api/docker/containers/sonarr/rollback', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, update: { phase: 'rolled-back', failedStep: 'start' } }),
    }));
    await section.locator('[data-docker-rollback]').click();
    await confirmDialog(page).getByRole('button', { name: /roll back/i }).click();
    const note = page.locator('#app-notification.show');
    await expect(note).toContainText('The rollback of sonarr failed at "start"');
    await expect(note).not.toContainText('The update of');
  });

  // Pulled already and not recreated: the newer image is on the host, so there
  // is no version on offer to skip -- only the container to put on it.
  test('a container left behind by its tag offers no skip', async ({ page }) => {
    const state = await mockDocker(page);
    state.containers.find((c) => c.name === 'sonarr').update = { status: 'available', recreate: true };
    await page.goto('/#docker/sonarr');
    const section = page.locator('[data-docker-drawer] [data-docker-section="updates"]');
    await section.locator('summary').click();
    await expect(section.locator('[data-docker-updates-status]')).toContainText('already on this host');
    await expect(section.locator('[data-docker-update-choice="hold"]')).toHaveCount(1);
    await expect(section.locator('[data-docker-update-choice="skip"]')).toHaveCount(0);
  });

  test('read-only shows the history but no choices or rollback', async ({ page }) => {
    const { section } = await openUpdates(page, { control: false });
    await expect(section.locator('[data-docker-update-history] li')).toHaveCount(1);
    await expect(section.locator('[data-docker-update-choice]')).toHaveCount(0);
    await expect(section.locator('[data-docker-rollback]')).toHaveCount(0);
  });

  test('updating a selection leaves out a skipped or held image', async ({ page }) => {
    const state = await mockDocker(page);
    state.containers.find((c) => c.name === 'jellyfin').update = { status: 'skipped', skippedDigest: 'sha256:r1' };
    await page.goto('/#docker');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.locator('[data-docker-row="sonarr"]').click();
    await page.locator('[data-docker-row="jellyfin"]').click({ modifiers: [mod] });
    await page.locator('[data-docker-bulk-action="update"]').click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('sonarr');
    await expect(dialog).not.toContainText('jellyfin');
    await dialog.getByRole('button', { name: /^update$/i }).click();
    await expect.poll(() => state.calls.filter((c) => c.endsWith('/update'))).toEqual(['POST /containers/sonarr/update']);
  });
});
