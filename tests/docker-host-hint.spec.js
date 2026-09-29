// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * Port links go to the host the page was opened on. Through a reverse proxy,
 * dash.example.com:8080 goes nowhere, and the page cannot tell which case it
 * is in -- so while no Docker host address is set, the view says where port
 * links point and offers the setting, until it is set or dismissed.
 */
async function open(page, settings) {
    await mockDocker(page);
    if (settings) {
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const res = await route.fetch();
            const body = await res.json();
            return route.fulfill({ response: res, json: { ...body, ...settings } });
        });
    }
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]').first()).toBeVisible();
}

test('no host address: the note, its way to the setting, and Dismiss', async ({ page }) => {
    await open(page);
    const hint = page.locator('[data-docker-host-hint]');
    await expect(hint).toContainText('Port links point at localhost');
    await hint.locator('[data-docker-host-hint-set]').click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.section)).toBe('containers');
    await expect.poll(() => page.evaluate(() => {
        const el = document.activeElement;
        return el ? [...el.attributes].some((a) => a.value === 'dockerHostAddress') : false;
    })).toBe(true);

    await page.goto('/#docker');
    await page.locator('[data-docker-host-hint-dismiss]').click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-docker-row]').first()).toBeVisible();
    await expect(hint).toHaveCount(0);
});

test('with a host address set there is no note', async ({ page }) => {
    await open(page, { dockerHostAddress: '192.168.1.10' });
    await expect(page.locator('[data-docker-host-hint]')).toHaveCount(0);
});
