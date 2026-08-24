// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Inbox, health and config share #dashboard-layout with the bookmark grid, and
 * the grid's own layout sync rewrites that container's class outright. Resizing
 * the window used to run that sync regardless of which view was on screen, so a
 * drag across the 767px stacking threshold stripped health-layout/inbox-layout
 * and scattered the view's header, toolbar and rows across grid columns — and it
 * never recovered, because nothing put the class back until the next navigation.
 *
 * A single setViewportSize jump does not reproduce it; the window has to be
 * resized in steps, which is what the CDP override below emulates.
 */
test.describe('view layout survives a window resize', () => {
    /** Resize in steps, the way dragging a window edge does. */
    async function dragResize(client, page, widths) {
        for (const width of widths) {
            await client.send('Emulation.setDeviceMetricsOverride', {
                width, height: 900, deviceScaleFactor: 1, mobile: false,
            });
            await page.waitForTimeout(180);
        }
        // Outlast the 120ms resize debounce in mobile-experience.js.
        await page.waitForTimeout(600);
    }

    async function layoutState(page) {
        return await page.evaluate(() => {
            const el = document.getElementById('dashboard-layout');
            const header = el.querySelector('.health-view-header, .inbox-header, .config-view');
            return {
                className: el.className,
                // The inbox marks its own container as the feed; health renders
                // a separate .health-view-feed inside it, and only when the
                // active filter has rows. Reading role off the container alone
                // therefore says nothing about health.
                role: el.getAttribute('role')
                    || el.querySelector('[role="feed"]')?.getAttribute('role')
                    || null,
                headerWidth: header ? Math.round(header.getBoundingClientRect().width) : null,
                containerWidth: Math.round(el.getBoundingClientRect().width),
            };
        });
    }

    for (const view of ['health', 'inbox']) {
        test(`${view} keeps its layout across shrink and regrow`, async ({ page, browserName }) => {
            test.skip(browserName !== 'chromium', 'CDP metrics override is chromium-only');

            await markWhatsNewSeen(page);
            await page.goto('/');
            await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
            await dismissOnboardingIfPresent(page);
            await dismissBlockingOverlays(page);
            await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });

            const client = await page.context().newCDPSession(page);
            await client.send('Emulation.setDeviceMetricsOverride', {
                width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
            });

            await page.goto(`/#${view}`);
            await page.waitForSelector(`#dashboard-layout.${view}-layout`, { timeout: 15_000 });
            await page.waitForTimeout(500);
            const before = await layoutState(page);

            // Down across the 767px threshold, then back up.
            await dragResize(client, page, [1200, 1000, 850, 700, 560, 460]);
            const narrow = await layoutState(page);
            expect(narrow.className).toContain(`${view}-layout`);
            // Only assert the feed role where one is rendered: health draws its
            // feed only when the active filter has rows, and an empty Broken
            // list is a legitimate state.
            if (before.role) expect(narrow.role).toBe('feed');
            // The view fills its container rather than sitting in a grid column.
            expect(narrow.headerWidth).toBe(narrow.containerWidth);

            await dragResize(client, page, [700, 1000, 1400]);
            const after = await layoutState(page);
            expect(after.className).toContain(`${view}-layout`);
            if (before.role) expect(after.role).toBe('feed');
            // Back at the starting width, the layout is what it was before.
            expect(after.className).toBe(before.className);
            expect(after.headerWidth).toBe(before.headerWidth);
            expect(after.containerWidth).toBe(before.containerWidth);
        });
    }

    test('config keeps its layout across shrink and regrow', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'CDP metrics override is chromium-only');

        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });

        const client = await page.context().newCDPSession(page);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
        });

        await page.goto('/#config');
        await page.waitForSelector('#dashboard-layout.config-layout', { timeout: 15_000 });
        await page.waitForTimeout(500);

        await dragResize(client, page, [1200, 1000, 850, 700, 560, 460]);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
        await dragResize(client, page, [700, 1000, 1400]);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
        // The panel is still one block, not a grid cell. Its own 1040px cap makes
        // it narrower than the container on a wide window, so this checks the
        // container is not columned rather than comparing the two widths.
        const state = await page.evaluate(() => {
            const el = document.getElementById('dashboard-layout');
            const panel = el.querySelector('.config-view');
            return {
                panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
                gridTemplateColumns: getComputedStyle(el).gridTemplateColumns,
            };
        });
        expect(state.panelWidth).toBeGreaterThan(700);
        expect(state.gridTemplateColumns).toBe('none');
    });

    test('the bookmark grid still re-columns on resize', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'CDP metrics override is chromium-only');

        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const client = await page.context().newCDPSession(page);
        await dragResize(client, page, [1400]);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/dashboard-grid/);

        // Guarding the sync must not stop the grid itself from restacking.
        await dragResize(client, page, [1000, 700, 500]);
        await expect
            .poll(() => page.evaluate(() => document.body.getAttribute('data-dashboard-stack-categories')))
            .toBe('true');
        await expect(page.locator('#dashboard-layout')).toHaveClass(/dashboard-grid/);

        await dragResize(client, page, [900, 1400]);
        await expect
            .poll(() => page.evaluate(() => document.body.getAttribute('data-dashboard-stack-categories')))
            .toBe('false');
        await expect(page.locator('#dashboard-layout')).toHaveClass(/dashboard-grid/);
    });
});
