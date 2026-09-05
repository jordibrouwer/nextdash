// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The memory tile: what is really in use, and what is merely kept warm.
 *
 * The endpoint is intercepted throughout, so these never depend on the machine
 * the tests run on.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function renderMemory(page, memory, config = {}, width = 320) {
    await page.route('**/api/system/metrics**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ memory }),
    }));

    return page.evaluate(async ({ cfg, w }) => {
        document.querySelectorAll('.mem-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget mem-probe';
        host.style.cssText = `width:${w}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetSystem = {};
        await window.DashboardWidgets.memory(body, { id: 'probe', type: 'memory', config: cfg }, d);

        const grid = body.querySelector('.dashboard-widget-stats');
        const cells = grid ? [...grid.children] : [];
        return {
            text: body.textContent.replace(/\s+/g, ' ').trim(),
            cells: cells.length,
            columns: grid
                ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length
                : 0,
            meters: body.querySelectorAll('.dashboard-widget-meter').length,
            rows: body.querySelectorAll('.dashboard-widget-row').length,
        };
    }, { cfg: config, w: width });
}

const GB = 1024 ** 3;
// 8 GiB total: 1 in use, 4.5 cached, 7 available -- a healthy idle machine, and
// exactly the shape that gets misreported as nearly full.
const READING = {
    available: true,
    totalBytes: 8 * GB,
    usedBytes: 1 * GB,
    availableBytes: 7 * GB,
    freeBytes: 2 * GB,
    cacheBytes: 4.5 * GB,
    usedPercent: 12.5,
    hasSwap: true,
    swapTotalBytes: 1 * GB,
    swapUsedBytes: 0.25 * GB,
    swapPercent: 25,
};

test.describe('the memory widget', () => {
    test('leads with what is in use against the total', async ({ page }) => {
        await openDashboard(page);
        const out = await renderMemory(page, READING);

        expect(out.text).toContain('13%');
        expect(out.text).toContain('GiB');
        // A bar, so the share is readable without doing the arithmetic.
        expect(out.meters).toBe(1);
    });

    /*
     * Page cache is handed back the moment anything asks for it. Counting it
     * as used is what makes a healthy Linux box look permanently full -- the
     * single most common way this figure is reported wrongly.
     */
    test('the file cache is not counted as used', async ({ page }) => {
        await openDashboard(page);
        const out = await renderMemory(page, READING, { showCache: true });

        // 1 GiB in use, not the 6 GiB a MemFree-based sum would show.
        expect(out.text).toContain('13%');
        expect(out.text).not.toContain('75%');
        expect(out.text.toLowerCase()).toContain('cache');
    });

    /*
     * Given two columns the tile says more rather than saying the same thing
     * larger: the figures sit abreast instead of wrapping into a block.
     */
    test('shows more statistics at two columns than at one', async ({ page }) => {
        await openDashboard(page);

        const narrow = await renderMemory(page, READING, { showCache: true }, 320);
        const wide = await renderMemory(page, READING, { showCache: true }, 700);

        expect(narrow.cells).toBe(4);
        expect(wide.cells).toBe(4);
        expect(wide.columns).toBeGreaterThan(narrow.columns);
        expect(wide.columns).toBe(4);
    });

    // Swap creeping upwards is the reading that actually predicts trouble.
    test('swap is shown when asked for', async ({ page }) => {
        await openDashboard(page);

        const without = await renderMemory(page, READING, {});
        expect(without.text.toLowerCase()).not.toContain('swap');

        const withSwap = await renderMemory(page, READING, { showSwap: true });
        expect(withSwap.text.toLowerCase()).toContain('swap');
        // Its own bar, beside the memory one.
        expect(withSwap.meters).toBe(2);
    });

    /*
     * Plenty of machines run without swap. Nought of nought draws as a full
     * bar waiting to happen, so it is said in words instead.
     */
    test('a machine without swap says so rather than drawing an empty bar', async ({ page }) => {
        await openDashboard(page);
        const out = await renderMemory(page, {
            ...READING, hasSwap: false, swapTotalBytes: 0, swapUsedBytes: 0, swapPercent: 0,
        }, { showSwap: true });

        expect(out.text.toLowerCase()).toContain('none');
        // Only the memory bar: no second one for swap that does not exist.
        expect(out.meters).toBe(1);
    });

    test('an unreadable host is explained, not reported as zero', async ({ page }) => {
        await openDashboard(page);
        const out = await renderMemory(page, { available: false, reason: 'unsupported-platform' });

        expect(out.text.toLowerCase()).toContain('linux');
        expect(out.text).not.toContain('0%');
        expect(out.meters).toBe(0);
    });
});

test.describe('the memory widget in config', () => {
    test('is offered with its settings', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const shape = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const C = cfg.constructor;
            const grouped = C.WIDGET_TYPE_GROUPS.find(([, types]) => types.includes('memory'));
            return {
                offered: C.WIDGET_TYPES.includes('memory'),
                group: grouped ? grouped[0] : null,
                fields: (C.WIDGET_SETTINGS.memory || []).map((f) => f.key),
                floor: (C.WIDGET_SETTINGS.memory || []).find((f) => f.key === 'refreshSeconds')?.min,
                about: cfg.widgetTypeAbout('memory'),
            };
        });

        expect(shape.offered).toBe(true);
        expect(shape.group).toBe('system');
        expect(shape.fields).toEqual(['refreshSeconds', 'showCache', 'showSwap']);
        expect(shape.floor).toBe(2);
        expect(shape.about).toBeTruthy();
    });
});
