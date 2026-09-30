// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Automatic updates are chosen per container: a switch in its side panel's
 * Updates section, or the selection bar for several. The window they run in
 * sits in Config -> Containers -> Updates. Settings writes are caught.
 */
async function catchSettings(page) {
    const saved = [];
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        saved.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    return saved;
}

test('the side panel switch turns automatic updates on for one container', async ({ page }) => {
    await mockDocker(page);
    const saved = await catchSettings(page);
    await page.goto('/#docker/sonarr');
    const drawer = page.locator('[data-docker-drawer]');
    await drawer.locator('[data-docker-section="updates"] summary').click();
    const box = drawer.locator('[data-docker-auto-update]');
    await expect(box).not.toBeChecked();
    await box.check();
    await expect.poll(() => saved.some((b) => (b.dockerAutoUpdate || []).includes('sonarr'))).toBe(true);
});

test('the selection bar turns it on for several, then off again', async ({ page }) => {
    await mockDocker(page);
    const saved = await catchSettings(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible();
    for (const name of ['sonarr', 'jellyfin']) {
        await page.locator(`[data-docker-row="${name}"]`).hover();
        await page.locator(`[data-docker-tick="${name}"]`).check();
    }
    const auto = page.locator('[data-docker-bulk-action="auto"]');
    await expect(auto).toHaveText('Update automatically');
    await auto.click();
    await expect.poll(() => saved.at(-1)?.dockerAutoUpdate?.slice().sort()).toEqual(['jellyfin', 'sonarr']);
    await expect(auto).toHaveText('Stop updating automatically');
    await auto.click();
    await expect.poll(() => saved.at(-1)?.dockerAutoUpdate).toEqual([]);
});

test('Config sets the window, 03:00 to 05:00 until changed', async ({ page }) => {
    await mockDocker(page);
    await catchSettings(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('containers'); });
    await expect(page.getByLabel('Automatic updates from')).toHaveValue('3');
    await expect(page.getByLabel('until', { exact: true })).toHaveValue('5');
});
