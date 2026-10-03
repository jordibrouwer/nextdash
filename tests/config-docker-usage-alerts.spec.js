// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config → Containers → Notifications: the usage alerts, on by default at 90 %
 * CPU and memory for 10 minutes, and a change is saved. The settings write is
 * caught, so the dev data dir is not touched.
 */
test('usage alerts sit under Notifications, 90 % for 10 minutes, and save', async ({ page }) => {
    const saved = [];
    await mockDocker(page);
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        saved.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('containers'); });
    // Containers is in tabs since the rework; the alerts have their own.
    await page.locator('[data-containers-tab="alerts"]').click();
    await expect(page.getByLabel('Also when one uses too much CPU or memory')).toBeChecked();
    await expect(page.getByLabel('CPU above')).toHaveValue('90');
    await expect(page.getByLabel('Memory above')).toHaveValue('90');
    await expect(page.getByLabel('For at least')).toHaveValue('10');
    await page.getByLabel('CPU above').selectOption('80');
    await expect.poll(() => saved.some((b) => Number(b.dockerCpuAlertPercent) === 80)).toBe(true);
});
