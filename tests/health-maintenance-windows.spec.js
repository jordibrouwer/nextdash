// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Behavior → Status & health → Maintenance windows.
 *
 * A window says "expect downtime here": checks still run and samples are still
 * recorded, but failures inside it raise no alert and do not count against
 * uptime. The list is a repeating structure rather than a single setting, so it
 * is the one control on the tab that is not schema-driven.
 */
async function openStatusTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.evaluate(() => {
        window.dashboardInstance.config.behaviorTab = 'status';
        window.dashboardInstance.config.render();
    });
    await page.waitForSelector('[data-maint-list]', { timeout: 10_000 });
}

const storedWindows = (page) => page.evaluate(async () =>
    (await (await fetch('/api/settings')).json()).maintenanceWindows || []);

async function clearWindows(page) {
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const settings = await (await fetch('/api/settings')).json();
        settings.maintenanceWindows = [];
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
    });
}

test.describe('maintenance windows', () => {
    test.afterEach(async ({ page }) => {
        await clearWindows(page);
    });

    test('a window can be added, scoped to days, and removed', async ({ page }) => {
        await openStatusTab(page);
        await expect(page.locator('[data-maint-list] .config-panel-empty')).toBeVisible();

        await page.locator('[data-maint-add]').click();
        await expect.poll(async () => (await storedWindows(page)).length).toBe(1);

        // Seven day buttons, all on: no days listed means every day, and showing
        // them all off would read as "this window never opens".
        await expect(page.locator('[data-maint-day]')).toHaveCount(7);
        await expect(page.locator('[data-maint-day].is-on')).toHaveCount(7);

        // Turning off Sunday and Saturday leaves the working week.
        await page.locator('[data-maint-day="0"]').click();
        await expect.poll(async () => (await storedWindows(page))[0]?.days?.length).toBe(6);
        await page.locator('[data-maint-day="6"]').click();
        await expect.poll(async () => (await storedWindows(page))[0]?.days).toEqual([1, 2, 3, 4, 5]);

        // Turning them all back on reads as "every day" rather than a list of
        // seven. normalizeMaintenanceWindows enforces this server-side, so this
        // asserts the stored shape rather than the client's own collapse.
        await page.locator('[data-maint-day="0"]').click();
        await page.locator('[data-maint-day="6"]').click();
        await expect.poll(async () => (await storedWindows(page))[0]?.days ?? []).toEqual([]);

        await page.locator('[data-maint-remove]').first().click();
        await expect.poll(async () => (await storedWindows(page)).length).toBe(0);
        await expect(page.locator('[data-maint-row]')).toHaveCount(0);
    });

    test('a window running past midnight says so rather than looking wrong', async ({ page }) => {
        await openStatusTab(page);
        await page.locator('[data-maint-add]').click();
        await expect.poll(async () => (await storedWindows(page)).length).toBe(1);

        await page.locator('[data-maint-start]').fill('23:00');
        await page.locator('[data-maint-start]').dispatchEvent('change');
        await page.locator('[data-maint-end]').fill('01:00');
        await page.locator('[data-maint-end]').dispatchEvent('change');

        await expect.poll(async () => {
            const w = (await storedWindows(page))[0];
            return `${w?.start}-${w?.end}`;
        }).toBe('23:00-01:00');
        // An end before a start is legal and common — most maintenance runs at
        // night — so the hint explains it instead of leaving it looking like a
        // typo the user should correct.
        await expect(page.locator('.config-maint-hint').first()).toBeVisible();
    });
});
