// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The Containers icon carries how many containers have an update waiting,
 * on its corner, the way the Bookmarks icon carries its problems and the Inbox
 * its unread.
 */
const badge = (page) => page.locator('#page-nav-docker-host .docker-link-anchor .docker-update-badge');

async function open(page, options) {
    await page.setViewportSize({ width: 1500, height: 950 });
    const state = await mockDocker(page, options);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#page-nav-docker-host .docker-link-anchor', { timeout: 15_000 });
    return state;
}

test.describe('the Containers icon\'s badge', () => {
    test('counts the containers with an update, on the icon\'s corner', async ({ page }) => {
        await open(page);
        await expect(badge(page)).toHaveText('1');
        await expect(badge(page)).toHaveAttribute('aria-label', /1 update/);
        const [b, a] = [await badge(page).boundingBox(), await page.locator('#page-nav-docker-host .docker-link-anchor').boundingBox()];
        expect(Math.abs((b.x + b.width / 2) - (a.x + a.width))).toBeLessThanOrEqual(b.width);
        expect(Math.abs((b.y + b.height / 2) - a.y)).toBeLessThanOrEqual(b.height);
    });

    test('none waiting, no badge', async ({ page }) => {
        const state = await open(page);
        await expect(badge(page)).toHaveText('1');
        // What the view reads next says nothing is waiting.
        state.containers.forEach((c) => { c.update = { status: 'current' }; });
        await page.locator('#page-nav-docker-host .docker-link-anchor').click();
        await page.waitForSelector('[data-docker-row]', { timeout: 15_000 });
        await expect(badge(page)).toHaveCount(0);
    });
});
