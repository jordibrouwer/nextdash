// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The containers tile: how many run, and what is quietly not.
 *
 * Which figures appear is the reader's choice, so most of what is pinned here
 * is that the choosing works -- including the rule that choosing nothing means
 * all of them, which is what keeps a figure added later from being hidden from
 * everyone who ever saved these settings.
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

async function renderDocker(page, docker, config = {}, width = 320) {
    await page.route('**/api/system/metrics**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ docker }),
    }));

    return page.evaluate(async ({ cfg, w }) => {
        document.querySelectorAll('.dk-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget dk-probe';
        host.style.cssText = `width:${w}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetSystem = {};
        await window.DashboardWidgets.docker(body, { id: 'probe', type: 'docker', config: cfg }, d);

        const grid = body.querySelector('.dashboard-widget-stats');
        // Only what is on screen counts. Figures and blocks the reader did not
        // ask for are built at every width and hidden again by the container
        // query, so a DOM count would report what nobody can see.
        const shown = (el) => el && el.offsetParent !== null;
        const cells = shown(grid) ? [...grid.children].filter(shown) : [];
        return {
            text: body.innerText.replace(/\s+/g, ' ').trim(),
            cells: cells.length,
            labels: cells.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
            columns: shown(grid)
                ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length
                : 0,
            rows: [...body.querySelectorAll('.dashboard-widget-row')].filter(shown).length,
        };
    }, { cfg: config, w: width });
}

const READING = {
    available: true,
    running: 12, stopped: 4, paused: 1, total: 17, images: 19, unhealthy: 1,
    unhealthyNames: ['jellyfin'],
    restartedNames: ['sonarr'],
    updates: 2, reclaimable: Math.round(3.2 * 1024 ** 3), reclaimableAt: Date.now() - 3600e3, incidents24h: 3,
    topCpu: [{ name: 'plex', cpu: 84.2 }, { name: 'immich', cpu: 21.5 }, { name: 'sonarr', cpu: 3.1 }],
};

test.describe('the containers widget', () => {
    test('leads with running against total', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, READING);

        // "12 running" cannot say something stopped last night; "12 of 17" can.
        expect(out.text).toContain('12');
        expect(out.text).toContain('17');
    });

    /*
     * Nothing chosen means every figure. Storing "all" as an empty list is what
     * keeps a figure added in a later version included by default, rather than
     * invisible to everyone who once saved this panel.
     */
    test('with nothing chosen a wide tile shows every figure', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, READING, {}, 700);
        expect(out.cells).toBe(9);
    });

    /*
     * Running and stopped are the pair a narrow tile has room to carry, and
     * the headline above them already says running against total. The rest
     * arrive with the width rather than stacking three rows deep in a column.
     */
    test('a narrow tile keeps the first two figures', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, READING, {}, 320);

        expect(out.cells).toBe(2);
        expect(out.labels.join(' ').toLowerCase()).toContain('running');
        expect(out.labels.join(' ').toLowerCase()).not.toContain('images');
    });

    test('shows only the figures that were chosen', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, READING, { show: ['running', 'unhealthy'] }, 700);

        expect(out.cells).toBe(2);
        expect(out.labels.join(' ').toLowerCase()).toContain('running');
        expect(out.labels.join(' ').toLowerCase()).toContain('unhealthy');
        // And the ones left out are genuinely gone, not merely reordered.
        expect(out.labels.join(' ').toLowerCase()).not.toContain('images');
    });

    /*
     * Given two columns the chosen figures spread across the width rather than
     * wrapping into a block.
     */
    test('spreads the chosen figures across a two-column tile', async ({ page }) => {
        await openDashboard(page);

        const narrow = await renderDocker(page, READING, { show: ['running', 'stopped', 'unhealthy'] }, 320);
        const wide = await renderDocker(page, READING, {}, 700);

        expect(wide.cells).toBeGreaterThan(narrow.cells);
        expect(wide.columns).toBeGreaterThan(narrow.columns);
        // Nine figures -- every one, nothing chosen -- go three abreast rather
        // than four: four columns would leave gaps on the last row.
        expect(wide.columns).toBe(3);
        expect(wide.cells % wide.columns).toBe(0);
    });

    /*
     * Whatever the reader picks, the row divides evenly. Four columns under
     * six figures left two empty cells, and under two it left half a row.
     */
    test('the chosen figures fill their row without gaps', async ({ page }) => {
        await openDashboard(page);

        for (const [chosen, wantColumns] of [
            [['running', 'unhealthy'], 2],
            [['running', 'stopped', 'unhealthy'], 3],
            [['running', 'stopped', 'total', 'images'], 4],
        ]) {
            const out = await renderDocker(page, READING, { show: chosen }, 700);
            expect(out.cells).toBe(chosen.length);
            expect(out.columns).toBe(wantColumns);
            // Nothing left over: the cells divide across the columns exactly.
            expect(out.cells % out.columns).toBe(0);
        }
    });

    /*
     * A count sends you looking; a name does not. Both lists are separate
     * toggles because a name is not a figure.
     */
    test('names what is failing and what just restarted, when asked', async ({ page }) => {
        await openDashboard(page);

        const counts = await renderDocker(page, READING, {});
        expect(counts.text).not.toContain('jellyfin');

        const named = await renderDocker(page, READING, {
            showUnhealthyNames: true, showRestarted: true,
        });
        expect(named.text).toContain('jellyfin');
        expect(named.text).toContain('sonarr');
        expect(named.rows).toBe(2);
    });

    // Updates as the reader sees them, what Disk last found reclaimable, and the
    // day's incidents: three figures more, chosen like the rest.
    test('shows updates, reclaimable space and the day\'s incidents when chosen', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, READING, { show: ['updates', 'reclaimable', 'incidents'] }, 700);
        expect(out.cells).toBe(3);
        const text = out.labels.join(' | ');
        expect(text).toMatch(/2\s*updates?/i);
        expect(text).toMatch(/3\.2 GiB/);
        expect(text).toMatch(/3\s*incidents/i);

        // Never measured: a dash, not a zero that claims there is nothing.
        const never = await renderDocker(page, { ...READING, reclaimable: -1, reclaimableAt: 0 }, { show: ['reclaimable'] }, 700);
        expect(never.labels.join(' ')).toContain('—');
    });

    test('names the three busiest containers when asked', async ({ page }) => {
        await openDashboard(page);
        const plain = await renderDocker(page, READING, { show: ['running'] }, 320);
        expect(plain.text).not.toContain('plex');
        const busy = await renderDocker(page, READING, { show: ['running'], showTopCpu: true }, 320);
        expect(busy.text).toContain('plex 84.2 %');
        expect(busy.text).toContain('immich 21.5 %');
        expect(busy.text).toContain('sonarr 3.1 %');
    });

    // Nothing to report is not a row saying nothing.
    test('a healthy machine adds no failing row', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, {
            ...READING, unhealthy: 0, unhealthyNames: [], restartedNames: [],
        }, { showUnhealthyNames: true, showRestarted: true });

        expect(out.rows).toBe(0);
        expect(out.text).toContain('12');
    });

    /*
     * An unmounted socket says so. Reporting nought containers would read as
     * "everything you run has disappeared", which is a worse lie than silence.
     */
    test('without the socket it explains rather than reporting zero', async ({ page }) => {
        await openDashboard(page);
        const out = await renderDocker(page, { available: false, reason: 'no-docker-socket' });

        expect(out.text.toLowerCase()).toContain('docker');
        expect(out.text).not.toContain('0 of 0');
        expect(out.cells).toBe(0);
    });
});

test.describe('the containers widget in config', () => {
    test('offers the figures as a choice, and warns about the socket', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const shape = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const C = cfg.constructor;
            const grouped = C.WIDGET_TYPE_GROUPS.find(([, types]) => types.includes('docker'));
            const fields = C.WIDGET_SETTINGS.docker || [];
            const show = fields.find((f) => f.key === 'show');
            const box = document.createElement('div');
            box.innerHTML = cfg.renderWidgetSetupNote('docker');
            return {
                offered: C.WIDGET_TYPES.includes('docker'),
                group: grouped ? grouped[0] : null,
                keys: fields.map((f) => f.key),
                showKind: show ? show.kind : null,
                options: show ? show.options.map((o) => o[0]) : [],
                note: box.textContent || '',
                code: box.querySelector('code')?.textContent || '',
            };
        });

        expect(shape.offered).toBe(true);
        expect(shape.group).toBe('system');
        expect(shape.keys).toEqual(['refreshSeconds', 'show', 'showUnhealthyNames', 'showRestarted', 'showTopCpu']);
        // A checkset, so every figure is a tickbox rather than a fixed layout.
        expect(shape.showKind).toBe('checkset');
        expect(shape.options).toEqual(
            ['running', 'stopped', 'paused', 'unhealthy', 'total', 'images', 'updates', 'reclaimable', 'incidents'],
        );
        // The socket is the one real privilege these widgets ask for, so the
        // panel says what it grants rather than only how to grant it.
        expect(shape.note.toLowerCase()).toContain('read-only');
        expect(shape.code).toContain('/var/run/docker.sock');
    });
});
