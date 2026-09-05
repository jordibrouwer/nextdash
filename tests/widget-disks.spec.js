// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The disks tile: how full each one is, and how much room is actually left.
 *
 * The endpoint is intercepted throughout, so these never depend on the machine
 * the tests run on -- the point of a source that reports its own availability.
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

/** Draw the tile at a given width with a canned reading behind it. */
async function renderDisks(page, disks, config = {}, width = 320) {
    await page.route('**/api/system/metrics**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ disks }),
    }));

    return page.evaluate(async ({ cfg, w }) => {
        document.querySelectorAll('.disks-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget disks-probe';
        host.style.cssText = `width:${w}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetSystem = {};
        await window.DashboardWidgets.disks(body, { id: 'probe', type: 'disks', config: cfg }, d);

        const grid = body.querySelector('.dashboard-widget-stats');
        const cells = grid ? [...grid.children] : [];
        return {
            text: body.textContent.replace(/\s+/g, ' ').trim(),
            cells: cells.length,
            columns: grid
                ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length
                : 0,
            rows: body.querySelectorAll('.dashboard-widget-row').length,
            meters: body.querySelectorAll('.dashboard-widget-meter').length,
        };
    }, { cfg: config, w: width });
}

const GB = 1024 ** 3;
const READING = {
    available: true,
    totalBytes: 1500 * GB,
    usedBytes: 900 * GB,
    freeBytes: 550 * GB,
    usedPercent: 60,
    readable: 2,
    unreadable: 0,
    mounts: [
        {
            path: '/mnt/user', label: 'Files',
            totalBytes: 1000 * GB, usedBytes: 600 * GB, freeBytes: 380 * GB,
            reservedBytes: 20 * GB, usedPercent: 60,
            inodesTotal: 1000000, inodesFree: 400000,
        },
        {
            path: '/mnt/cache', label: 'Cache',
            totalBytes: 500 * GB, usedBytes: 300 * GB, freeBytes: 170 * GB,
            reservedBytes: 30 * GB, usedPercent: 60,
            inodesTotal: 500000, inodesFree: 450000,
        },
    ],
};

test.describe('the disks widget', () => {
    test('leads with the pool and lists each disk by its name', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDisks(page, READING);

        // The headline is the whole pool, so nobody has to add rows up.
        expect(out.text).toContain('550');
        expect(out.text).toContain('Files');
        expect(out.text).toContain('Cache');
        // Each row says free against total: the second figure is what makes
        // the first mean anything.
        expect(out.text).toContain('380');
        expect(out.text).toContain('1000');
    });

    /*
     * Given two columns the tile says more rather than saying the same thing
     * larger: the totals break into four figures across the top.
     */
    test('shows more statistics at two columns than at one', async ({ page }) => {
        await openDashboard(page);

        const narrow = await renderDisks(page, READING, {}, 320);
        const wide = await renderDisks(page, READING, {}, 700);

        // Same four figures either way...
        expect(narrow.cells).toBe(4);
        expect(wide.cells).toBe(4);
        // ...but spread across the width instead of wrapped into a block.
        expect(wide.columns).toBeGreaterThan(narrow.columns);
        expect(wide.columns).toBe(4);
    });

    /*
     * Reserved blocks belong to root: neither used nor free. Folding them into
     * either one misreports the disk by whole gigabytes.
     */
    test('free is what can be written, not total minus used', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDisks(page, READING);

        // 1000 total, 600 used, 380 free, 20 reserved -- free is the 380.
        expect(out.text).toContain('380');
        expect(out.text).not.toContain('400 GiB free');
    });

    /*
     * An array with one drive spun down is exactly the moment the other
     * figures still matter.
     */
    test('one unreadable disk does not blank the others', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDisks(page, {
            ...READING,
            readable: 1,
            unreadable: 1,
            mounts: [
                READING.mounts[0],
                { path: '/mnt/disk9', label: 'Disk 9', totalBytes: 0, usedBytes: 0, freeBytes: 0, error: 'unreadable' },
            ],
        });

        expect(out.text).toContain('Files');
        expect(out.text).toContain('Disk 9');
        expect(out.text.toLowerCase()).toContain('unreadable');
        // And the failed one reports no figures of its own.
        expect(out.text).not.toContain('Disk 9 0 B free of 0 B');
    });

    /*
     * A disk is a group: its figures, its bar, its file table. Most row lists
     * pair into two columns on a wide tile, which splits those apart and puts
     * one disk's bar beside another disk's name.
     */
    test('each disk stays with its own bar on a wide tile', async ({ page }) => {
        await openDashboard(page);
        await page.route('**/api/system/metrics**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ disks: READING }),
        }));

        const shape = await page.evaluate(async () => {
            document.querySelectorAll('.disks-probe').forEach((n) => n.remove());
            const host = document.createElement('div');
            host.className = 'dashboard-widget disks-probe';
            host.style.cssText = 'width:700px;position:fixed;left:10px;top:10px;z-index:9999;';
            const body = document.createElement('div');
            body.className = 'dashboard-widget-body';
            host.appendChild(body);
            document.body.appendChild(host);

            const d = window.dashboardInstance;
            d._widgetSystem = {};
            await window.DashboardWidgets.disks(
                body, { id: 'probe', type: 'disks', config: { showInodes: true } }, d,
            );

            const list = body.querySelector('.dashboard-widget-rows');
            const kids = [...list.children];
            const out = {
                paired: list.className.includes('pairs'),
                children: kids.length,
                // One per line: nothing sitting beside anything else.
                lines: new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size,
            };
            host.remove();
            return out;
        });

        expect(shape.paired).toBe(false);
        expect(shape.children).toBeGreaterThan(1);
        expect(shape.lines).toBe(shape.children);
    });

    test('with no disks chosen it says so rather than showing nothing', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDisks(page, { available: false, reason: 'no-mounts-configured' });

        expect(out.text.toLowerCase()).toContain('settings');
        expect(out.rows).toBe(0);
    });

    test('the meter and the file table follow their toggles', async ({ page }) => {
        await openDashboard(page);

        const bare = await renderDisks(page, READING, { showMeter: false });
        expect(bare.meters).toBe(0);

        const full = await renderDisks(page, READING, { showInodes: true });
        // One meter per disk, plus a files row per disk.
        expect(full.meters).toBe(2);
        expect(full.text.toLowerCase()).toContain('files');
    });
});

test.describe('the disks widget in config', () => {
    /*
     * Typing a mountpoint blind is the weak point of naming disks by hand: a
     * typo produces a tile that says "unreadable" without saying why. So the
     * panel offers what this machine actually has -- as a shortcut into the
     * same field, never as a second place the value lives.
     */
    test('offers the disks this machine has, and clicking one fills the field', async ({ page }) => {
        await openDashboard(page);
        await page.route('**/api/system/mounts', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mounts: [
                    { path: '/mnt/user', fsType: 'xfs', totalBytes: 1000 * GB, freeBytes: 380 * GB },
                    { path: '/mnt/cache', fsType: 'btrfs', totalBytes: 500 * GB, freeBytes: 30 * GB },
                ],
            }),
        }));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const shown = await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config._module;
            const host = document.createElement('div');
            host.className = 'suggest-probe';
            host.innerHTML = cfg.renderWidgetSettings({ type: 'disks', config: {} }, 0);
            document.body.appendChild(host);
            // The disks live on the machine, so they arrive after the markup.
            cfg._mountCandidates = null;
            await cfg.fillWidgetSuggestions(host);

            const chips = [...host.querySelectorAll('.config-widget-chip')];
            const field = host.querySelector('input[data-widget-kind="tags"]');
            const before = field.value;

            /*
             * Through addSuggestedMount rather than a DOM click: the click
             * listener is delegated from the config panel, and this markup is
             * built outside it. What is under test is what the chip does to
             * the field, which is this method either way.
             */
            cfg.addSuggestedMount(chips[0]);
            const afterOne = field.value;
            // Clicking the same disk twice must not store it twice.
            cfg.addSuggestedMount(chips[0]);
            const afterTwice = field.value;
            cfg.addSuggestedMount(chips[1]);
            const afterBoth = field.value;

            const labels = chips.map((c) => c.textContent.replace(/\s+/g, ' ').trim());
            host.remove();
            return { labels, before, afterOne, afterTwice, afterBoth };
        });

        expect(shown.labels.length).toBe(2);
        // The size is what makes the list pickable: which /mnt/diskN is the big one.
        expect(shown.labels[0]).toContain('/mnt/user');
        expect(shown.labels[0]).toContain('free');
        expect(shown.before).toBe('');
        expect(shown.afterOne).toBe('/mnt/user');
        expect(shown.afterTwice).toBe('/mnt/user');
        expect(shown.afterBoth).toBe('/mnt/user, /mnt/cache');
    });

    // A machine with no mount table is not a failure: typing still works.
    test('says so when there are no disks to offer', async ({ page }) => {
        await openDashboard(page);
        await page.route('**/api/system/mounts', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ mounts: [] }),
        }));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const text = await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config._module;
            const host = document.createElement('div');
            host.innerHTML = cfg.renderWidgetSettings({ type: 'disks', config: {} }, 0);
            document.body.appendChild(host);
            cfg._mountCandidates = null;
            await cfg.fillWidgetSuggestions(host);
            const out = host.querySelector('[data-widget-suggest]')?.textContent || '';
            host.remove();
            return out;
        });

        expect(text.toLowerCase()).toContain('type a path');
    });

    test('is offered with settings and the mount it needs', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const shape = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const C = cfg.constructor;
            const grouped = C.WIDGET_TYPE_GROUPS.find(([, types]) => types.includes('disks'));
            const box = document.createElement('div');
            box.innerHTML = cfg.renderWidgetSetupNote('disks');
            return {
                offered: C.WIDGET_TYPES.includes('disks'),
                group: grouped ? grouped[0] : null,
                fields: (C.WIDGET_SETTINGS.disks || []).map((f) => f.key),
                floor: (C.WIDGET_SETTINGS.disks || []).find((f) => f.key === 'refreshSeconds')?.min,
                code: box.querySelector('code')?.textContent || '',
                note: box.textContent || '',
            };
        });

        expect(shape.offered).toBe(true);
        expect(shape.group).toBe('system');
        expect(shape.fields).toEqual(['refreshSeconds', 'mounts', 'labels', 'showMeter', 'showInodes']);
        // Five seconds: statfs on a sleeping disk can stall.
        expect(shape.floor).toBe(5);
        // The exact lines to copy, and where they go on Unraid.
        expect(shape.code).toContain('/mnt:/host/root/mnt:ro');
        expect(shape.code).toContain('NEXTDASH_HOST_ROOT=/host/root');
        expect(shape.note).toContain('Unraid');
    });
});
