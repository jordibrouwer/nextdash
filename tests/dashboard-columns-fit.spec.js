// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * As many columns as fit, and one only when nothing else does.
 *
 * Below 768px the grid used to drop straight to a single column, whatever the
 * device -- a desktop window with room for two or three got one long list --
 * and above it the configured count was kept however narrow the columns got.
 * Now a desktop window takes as many of its configured columns as fit at
 * their minimum width, and only a phone held upright always stacks.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.columnsPerRow = 4;
        await d.renderDashboard({ animate: false });
    });
}

async function columns(page) {
    return page.evaluate(() => {
        const m = /columns-(\d+)/.exec(document.getElementById('dashboard-layout').className);
        // Where the categories actually stand, not only what the class says:
        // a stylesheet can still force its own column count over it.
        const lefts = new Set([...document.querySelectorAll('#dashboard-layout .category')]
            .filter((el) => el.getClientRects().length)
            .map((el) => Math.round(el.getBoundingClientRect().left)));
        return {
            count: m ? Number(m[1]) : null,
            drawn: lefts.size,
            stacked: document.body.getAttribute('data-dashboard-stack-categories'),
        };
    });
}

test.describe('desktop window', () => {
    test('narrows to the columns that fit, and to one only when two do not', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await openDashboard(page);
        await expect.poll(() => columns(page)).toEqual({ count: 4, drawn: 4, stacked: 'false' });

        // Room for two at their minimum width: two, not one.
        await page.setViewportSize({ width: 760, height: 900 });
        await expect.poll(() => columns(page)).toEqual({ count: 2, drawn: 2, stacked: 'false' });

        // Not even two fit: then one.
        await page.setViewportSize({ width: 480, height: 900 });
        await expect.poll(() => columns(page)).toEqual({ count: 1, drawn: 1, stacked: 'false' });

        // And back, without a reload.
        await page.setViewportSize({ width: 1400, height: 900 });
        await expect.poll(() => columns(page)).toEqual({ count: 4, drawn: 4, stacked: 'false' });
    });

    test('never more columns than configured', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await openDashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.columnsPerRow = 2;
            await d.renderDashboard({ animate: false });
        });
        await expect.poll(() => columns(page)).toEqual({ count: 2, drawn: 2, stacked: 'false' });
    });
});

test.describe('phone held upright', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('stacks into one column', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'isMobile is chromium-only');
        await openDashboard(page);
        await expect.poll(() => columns(page)).toEqual({ count: 1, drawn: 1, stacked: 'true' });
    });
});
