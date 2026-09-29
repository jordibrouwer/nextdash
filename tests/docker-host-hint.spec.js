// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * Port links go to the host the page was opened on. Opened through a domain
 * (a reverse proxy), dash.example.com:8080 goes nowhere, so the view says so
 * and offers the Docker host address setting -- until it is set or dismissed.
 * The tests run on localhost, so the domain check is decided separately and
 * the note is driven by standing in for it.
 */
test('the domain check: a proxy domain counts, a LAN name, an IP or a set address does not', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]').first()).toBeVisible();
    const verdicts = await page.evaluate(() => {
        const f = (host, settings = {}) => window.DashboardDocker.opensThroughADomain(settings, host);
        return [f('dash.test.nl'), f('nas'), f('nas.local'), f('192.168.1.10'), f('localhost'),
            f('dash.test.nl', { dockerHostAddress: '192.168.1.10' })];
    });
    expect(verdicts).toEqual([true, false, false, false, false, false]);
    // On localhost, no note.
    await expect(page.locator('[data-docker-host-hint]')).toHaveCount(0);
});

test('opened through a domain: the note, its way to the setting, and Dismiss', async ({ page }) => {
    await mockDocker(page);
    await page.addInitScript(() => {
        const wait = setInterval(() => {
            if (!window.DashboardDocker) return;
            clearInterval(wait);
            window.DashboardDocker.opensThroughADomain = () => true;
        }, 10);
    });
    await page.goto('/#docker');
    const hint = page.locator('[data-docker-host-hint]');
    await expect(hint).toBeVisible();
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
