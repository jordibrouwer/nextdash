// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The drawer's small buttons -- Show value beside a variable, Refresh above the
 * logs -- look like the drawer's other buttons, not like the browser's own.
 *
 * They had classes no stylesheet knew, so Safari drew its grey pill.
 */

async function look(locator) {
    return locator.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, border: cs.borderTopStyle, radius: cs.borderTopLeftRadius, font: cs.fontFamily };
    });
}

test.describe('the container drawer\'s small buttons', () => {
    test('Show value is drawn like Restart', async ({ page }) => {
        await mockDocker(page);
        await page.goto('/#docker/sonarr');
        const drawer = page.locator('[data-docker-drawer]');
        await drawer.locator('[data-docker-section="env"] summary').click();
        const reveal = drawer.locator('[data-docker-env-reveal="API_KEY"]');
        await expect(reveal).toBeVisible();
        const action = drawer.locator('[data-docker-action="restart"]');
        const a = await look(reveal);
        const b = await look(action);
        expect(a.bg).toBe(b.bg);
        expect(a.border).toBe(b.border);
        expect(a.font).toBe(b.font);
    });

    test('Refresh is drawn like Restart, and sits clear of the log', async ({ page }) => {
        await mockDocker(page);
        await page.goto('/#docker/sonarr');
        const drawer = page.locator('[data-docker-drawer]');
        await drawer.locator('[data-slp-tab="logs"]').click();
        const refresh = drawer.locator('[data-docker-logs-refresh]');
        await expect(drawer.locator('[data-docker-logs]')).toContainText('line two');
        const a = await look(refresh);
        const b = await look(drawer.locator('[data-docker-action="restart"]'));
        expect(a.bg).toBe(b.bg);
        expect(a.font).toBe(b.font);
        const button = await refresh.boundingBox();
        const log = await drawer.locator('[data-docker-logs]').boundingBox();
        expect(button && log && button.y + button.height <= log.y).toBe(true);
    });
});
