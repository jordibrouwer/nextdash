// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, markConfigSettingPromosSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config -> Containers is five tabs, wired the way Config -> Inbox is: one
 * strip, the arrow keys, a remembered tab, a deep link, and a setting found by
 * search opening its own tab.
 */

const TABS = ['connection', 'view', 'updates', 'alerts', 'unraid'];

// What each tab shows, in order.
const TITLES = {
    connection: ['Connection', 'Safety'],
    view: ['View', 'Links', 'Hidden containers'],
    updates: ['Updates', 'GitHub'],
    alerts: ['Notifications', 'Muted containers'],
    unraid: ['Unraid'],
};

async function open(page, hash = '#config/containers') {
    await markWhatsNewSeen(page);
    await markConfigSettingPromosSeen(page);
    await mockDocker(page);
    await page.goto(`/${hash}`);
    await page.waitForSelector('[data-containers-tab]', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // A load draws config twice; what is typed or clicked before the second
    // draw is drawn over.
    await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
}

const tab = (page, id) => page.locator(`[data-containers-tab="${id}"]`);
const titles = (page) => page.locator('#config-containers-body .config-panel-title');

test.describe('Config -> Containers tabs', () => {
    test('five tabs, Connection first, each with exactly its panels', async ({ page }) => {
        await open(page);
        await expect(page.locator('[data-containers-tab]')).toHaveCount(5);
        await expect(page.locator('[data-containers-tab]')).toHaveText(['Connection', 'View', 'Updates', 'Alerts', 'Unraid']);
        await expect(tab(page, 'connection')).toHaveAttribute('aria-selected', 'true');
        for (const id of TABS) {
            await tab(page, id).click();
            await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
            await expect(titles(page)).toHaveText(TITLES[id]);
        }
        // The panels that moved still do their work on their new tab.
        await tab(page, 'view').click();
        await expect(page.locator('[data-behavior-field="dockerRefreshSeconds"]')).toBeVisible();
        await tab(page, 'unraid').click();
        await expect(page.locator('[data-unraid-field="baseUrl"]')).toBeVisible();
    });

    test('the arrow keys move between tabs', async ({ page }) => {
        await open(page);
        await tab(page, 'connection').focus();
        await page.keyboard.press('ArrowRight');
        await expect(tab(page, 'view')).toHaveAttribute('aria-selected', 'true');
        await expect(titles(page)).toHaveText(TITLES.view);
        await page.keyboard.press('End');
        await expect(tab(page, 'unraid')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowRight');
        await expect(tab(page, 'connection')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowLeft');
        await expect(tab(page, 'unraid')).toHaveAttribute('aria-selected', 'true');
        await expect(tab(page, 'unraid')).toBeFocused();
    });

    test('the chosen tab is there after a reload', async ({ page }) => {
        await open(page);
        await tab(page, 'alerts').click();
        await expect(titles(page)).toHaveText(TITLES.alerts);
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#config/containers/alerts');
        // A fresh load of the bare section address: the memory, not the hash, decides.
        await page.goto('/?again=1#config/containers');
        await page.waitForSelector('[data-containers-tab]', { timeout: 20_000 });
        await expect(tab(page, 'alerts')).toHaveAttribute('aria-selected', 'true');
        await expect(titles(page)).toHaveText(TITLES.alerts);
    });

    test('#config/containers/unraid opens the Unraid tab', async ({ page }) => {
        await open(page, '#config/containers/unraid');
        await expect(tab(page, 'unraid')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-unraid-field="baseUrl"]')).toBeVisible();
        await expect(titles(page)).toHaveText(TITLES.unraid);
    });

    test('a setting found by search opens its tab', async ({ page }) => {
        await open(page);
        await expect(tab(page, 'connection')).toHaveAttribute('aria-selected', 'true');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('Check for image updates');
        await expect(page.locator('.config-settings-jump-result').first()).toContainText(/Check for image updates/);
        await expect(page.locator('.config-settings-jump-result').first()).toContainText('Updates');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(tab(page, 'updates')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-behavior-field="dockerUpdateInterval"]')).toBeVisible();
    });

    test('"Set up Unraid" on a widget lands on the Unraid tab', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await markWhatsNewSeen(page);
        await markConfigSettingPromosSeen(page);
        await page.route('**/api/unraid/area/**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ area: 'array', status: 'not-configured' }),
        }));
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.evaluate(async () => {
            const host = document.createElement('div');
            host.className = 'dashboard-widget unraid-probe';
            host.style.cssText = 'width:320px;position:fixed;left:10px;top:10px;z-index:9999;';
            const body = document.createElement('div');
            body.className = 'dashboard-widget-body';
            host.appendChild(body);
            document.body.appendChild(host);
            await window.DashboardWidgets.unraidArray(body, { id: 'probe', type: 'unraidArray', config: {} }, window.dashboardInstance);
        });
        await page.locator('.unraid-probe').getByText('Set up Unraid').click();
        await page.waitForSelector('[data-containers-tab]', { timeout: 20_000 });
        await expect(tab(page, 'unraid')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-unraid-field="baseUrl"]')).toBeVisible();
    });
});
