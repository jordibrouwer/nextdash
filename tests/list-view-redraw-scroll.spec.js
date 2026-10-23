// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A list view that redraws while the reader is scrolled down keeps its place.
 *
 * Every poll empties the Containers list and fills it again. Something in
 * between that reads a style or a size -- an app icon asks the theme whether it
 * is dark -- laid the page out with the list empty, the page was then shorter
 * than where the reader had scrolled to, and the browser moved the scroll to
 * the top. Filling the list again did not move it back, so a reader who
 * scrolled down and waited was thrown to the top every few seconds.
 *
 * The read is forced here on every build of the table, so the test does not
 * depend on how a particular browser resolves the icon's style read.
 */

const containers = Array.from({ length: 60 }, (_, i) => ({
    id: String(i).padStart(2, '0').repeat(32), shortId: String(i).padStart(2, '0').repeat(6),
    name: `svc-${i}`, image: `img/svc-${i}:latest`, tag: 'latest',
    state: i % 4 === 0 ? 'exited' : 'running', status: i % 4 === 0 ? 'Exited (0) 2 hours ago' : 'Up 7 hours',
    health: '', created: 1790000000, ports: [{ private: 8000 + i, public: 8000 + i, type: 'tcp' }],
}));

test('a poll that redraws the Containers list leaves a scrolled reader where they were', async ({ page }) => {
    await mockDocker(page, { containers });
    await page.setViewportSize({ width: 1100, height: 600 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('Shift+Y');
    await expect(page.locator('.docker-row')).toHaveCount(containers.length);

    // Every build of the table now reads a size half-way, as an icon's style read can.
    await page.evaluate(() => {
        const view = window.dashboardInstance.docker.instance;
        const proto = Object.getPrototypeOf(view);
        const build = proto.buildTable;
        proto.buildTable = function (...args) {
            void document.body.offsetHeight;
            return build.apply(this, args);
        };
    });

    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(1000);
    const before = await page.evaluate(() => Math.round(window.scrollY));

    for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() => window.dashboardInstance.docker.instance.refreshContainers());
        await expect(page.locator('.docker-row')).toHaveCount(containers.length);
    }
    // Where the reader was, give or take the header folding.
    expect(Math.abs(await page.evaluate(() => Math.round(window.scrollY)) - before)).toBeLessThan(80);
});
