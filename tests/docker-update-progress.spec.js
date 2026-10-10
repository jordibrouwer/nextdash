// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * An update says what it is doing: the overlay lists each container with the
 * steps the server streams and a few log lines, and when one fails it stays
 * open with the reason until the reader closes it. A bulk update takes only
 * the containers with an update on offer.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const overlay = (page) => page.locator('#nextdash-progress-overlay');
const item = (page, name) => overlay(page).locator(`[data-docker-run-item="${name}"]`);

async function openView(page, opts) {
    const state = await mockDocker(page, opts);
    state.updateFails = new Set();
    await page.goto('/#docker');
    await page.locator('[data-docker-group]').selectOption('none');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    return state;
}

test('a failed update stays open with its steps, log and reason', async ({ page }) => {
    const state = await openView(page);
    state.updateFails.add('sonarr');
    await page.locator('[data-docker-row="sonarr"]').click({ button: 'right' });
    await page.locator('[data-docker-menu-action="update"]').click();
    await page.locator('.modal[role="dialog"]').getByRole('button', { name: /^update$/i }).click();

    const row = item(page, 'sonarr');
    await expect(row).toHaveAttribute('data-state', 'fail');
    await expect(row.locator('[data-step="pull"]')).toHaveAttribute('data-state', 'done');
    await expect(row.locator('[data-step="create"]')).toHaveAttribute('data-state', 'fail');
    await expect(row.locator('[data-step="restore"]')).toHaveAttribute('data-state', 'done');
    await expect(row.locator('[data-docker-run-log]')).toContainText('create failed: conflicting options');
    await expect(row).toContainText(/failed at "create"/);
    expect(state.calls).toContain('POST /containers/sonarr/update');

    const close = overlay(page).getByRole('button', { name: /^close$/i });
    await expect(close).toBeFocused();
    await close.click();
    await expect(overlay(page)).toBeHidden();
});

test('a bulk update lists each container, skips the ones without an update, and stays with the outcome', async ({ page }) => {
    const state = await openView(page);
    const jellyfin = state.containers.find((c) => c.name === 'jellyfin');
    jellyfin.update = { status: 'available', checkedAt: Date.now() };
    state.updateFails.add('jellyfin');
    await page.evaluate(() => window.dashboardInstance.docker.refreshContainers());

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(`${mod}+a`);
    await page.locator('[data-docker-bulk] [data-docker-bulk-action="update"]').click();
    const dialog = page.locator('.modal[role="dialog"]');
    await expect(dialog).toContainText('jellyfin, sonarr');
    await expect(dialog).toContainText(/No update on offer for bazarr; left out/);
    await dialog.getByRole('button', { name: /^update$/i }).click();

    await expect(item(page, 'sonarr')).toHaveAttribute('data-state', 'done');
    await expect(item(page, 'jellyfin')).toHaveAttribute('data-state', 'fail');
    await expect(item(page, 'bazarr')).toHaveCount(0);
    await expect(overlay(page)).toContainText('1 updated, 1 failed');
    await expect(item(page, 'jellyfin')).toContainText(/failed at "create"/);
    expect(state.calls.filter((c) => c.endsWith('/update')).sort())
        .toEqual(['POST /containers/jellyfin/update', 'POST /containers/sonarr/update']);
    await overlay(page).getByRole('button', { name: /^close$/i }).click();
    await expect(overlay(page)).toBeHidden();
});
