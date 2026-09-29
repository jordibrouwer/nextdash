// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * A container's size, as `docker ps -s` gives it: what it wrote in the Size
 * column, and that with its image on hover and in the side panel. The server
 * measures in the background every half hour, so a container not measured yet
 * reads —.
 */
const MiB = 1024 * 1024;

async function open(page) {
    const state = await mockDocker(page, { control: true });
    const jelly = state.containers.find((c) => c.name === 'jellyfin');
    jelly.size = { rw: 24 * MiB, rootFs: 568 * MiB };
    await page.goto('/#docker');
    await page.locator('[data-docker-group]').selectOption('none');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    return state;
}

test('the Size column shows what a container wrote, and with its image on hover', async ({ page }) => {
    await open(page);
    const cell = page.locator('[data-docker-row="jellyfin"] .docker-cell--size');
    await expect(cell).toHaveText('24.0 MiB');
    await expect(cell).toHaveAttribute('title', '24.0 MiB written · 568 MiB with its image');
    // Not measured yet: a dash, no title.
    await expect(page.locator('[data-docker-row="bazarr"] .docker-cell--size')).toHaveText('—');
});

test('the side panel names the size in Details and Resources', async ({ page }) => {
    await open(page);
    await page.goto('/#docker/jellyfin');
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer.locator('[data-docker-body="overview"]')).toContainText('24.0 MiB written · 568 MiB with its image');
    await drawer.locator('[data-slp-tab="resources"]').click();
    await expect(drawer.locator('[data-docker-size]')).toHaveText('24.0 MiB');
});
