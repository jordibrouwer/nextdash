// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The processor tile: how busy it is, and whether work is queueing up behind it.
 *
 * The endpoint is intercepted throughout, so these never depend on the machine
 * the tests happen to run on -- which is the point of the source reporting its
 * own availability rather than a number.
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
async function renderCPU(page, cpu, config = {}, width = 320) {
    await page.route('**/api/system/metrics**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ cpu }),
    }));

    return page.evaluate(async ({ cfg, w }) => {
        document.querySelectorAll('.cpu-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget cpu-probe';
        host.style.cssText = `width:${w}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetSystem = {};
        await window.DashboardWidgets.cpu(body, { id: 'probe', type: 'cpu', config: cfg }, d);

        const grid = body.querySelector('.dashboard-widget-stats');
        const cells = grid ? [...grid.children] : [];
        return {
            text: body.textContent.replace(/\s+/g, ' ').trim(),
            cells: cells.length,
            // How many rows the figures ended up on, read off the geometry
            // rather than the class: this is the thing the reader sees.
            rows: new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top))).size,
            // And how many columns the grid was actually given, which is what
            // "fills a wide tile" means and what a row count alone cannot say:
            // three figures across four columns is still one row.
            columns: grid
                ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length
                : 0,
        };
    }, { cfg: config, w: width });
}

const READING = { available: true, percent: 12.4, load1: 0.07, load5: 0.15, load15: 0.11, cores: 4 };

test.describe('the processor widget', () => {
    test('shows the percentage, and the load average when asked', async ({ page }) => {
        await openDashboard(page);
        const out = await renderCPU(page, READING, { showLoad: true });

        expect(out.text).toContain('12%');
        expect(out.text).toContain('0.07');
        expect(out.text).toContain('0.15');
        expect(out.text).toContain('0.11');
    });

    /*
     * /proc/stat is cumulative, so the first read has nothing to compare
     * against. Printing 0% there would report an idle machine that nobody
     * measured -- the load average is known immediately and stands in.
     */
    test('waits for the second sample instead of inventing a percentage', async ({ page }) => {
        await openDashboard(page);
        const out = await renderCPU(page, { ...READING, percent: null }, { showLoad: true });

        expect(out.text).toContain('0.07');
        expect(out.text).not.toContain('0%');
        expect(out.text).not.toContain('NaN');
    });

    /*
     * nextDash runs in a container, where /proc is its own cgroup unless the
     * host was mounted in. Saying so names the setup step; showing 0% would be
     * a confident lie about an idle machine.
     */
    test('an unmounted host is explained, not reported as zero', async ({ page }) => {
        await openDashboard(page);
        const out = await renderCPU(page, { available: false, reason: 'no-host-proc' });

        expect(out.text.toLowerCase()).toContain('proc');
        expect(out.text).not.toContain('0%');
        expect(out.cells).toBe(0);
    });

    /*
     * Given two columns the tile should say more rather than say the same
     * thing larger: the load windows sit abreast instead of stretching.
     */
    test('spreads its figures across a two-column tile', async ({ page }) => {
        await openDashboard(page);

        const narrow = await renderCPU(page, READING, { showLoad: true, showCores: true }, 320);
        const wide = await renderCPU(page, READING, { showLoad: true, showCores: true }, 700);

        expect(narrow.cells).toBe(4);
        expect(wide.cells).toBe(4);
        // Same four figures, one row instead of two...
        expect(wide.rows).toBe(1);
        expect(narrow.rows).toBeGreaterThan(1);
        // ...because the grid was given more columns, which is the actual
        // claim. A row count alone would pass even without the wide layout,
        // since three figures across four columns is also a single row.
        expect(wide.columns).toBeGreaterThan(narrow.columns);
        expect(wide.columns).toBe(4);
    });

    /*
     * The settings panel draws each checkbox from the stored value alone, so a
     * default-on boolean would sit unticked over a tile that was showing the
     * thing. Both toggles are off until ticked, and the tile matches.
     */
    test('the toggles mean exactly what the checkboxes say', async ({ page }) => {
        await openDashboard(page);

        const bare = await renderCPU(page, READING, {});
        expect(bare.text).toContain('12%');
        expect(bare.text).not.toContain('0.07');
        expect(bare.cells).toBe(0);

        const withCores = await renderCPU(page, READING, { showLoad: true, showCores: true });
        expect(withCores.text).toContain('4');
        expect(withCores.cells).toBe(4);
    });
});

test.describe('the processor widget in config', () => {
    test('is offered under its own group, with settings', async ({ page }) => {
        await openDashboard(page);
        // The config view is loaded on demand, and the tables are statics on
        // the loaded module rather than on the loader standing in for it.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const shape = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const C = cfg.constructor;
            const grouped = C.WIDGET_TYPE_GROUPS.find(([, types]) => types.includes('cpu'));
            const fields = (C.WIDGET_SETTINGS.cpu || []).map((f) => f.key);
            const refresh = (C.WIDGET_SETTINGS.cpu || []).find((f) => f.key === 'refreshSeconds');
            return {
                offered: C.WIDGET_TYPES.includes('cpu'),
                group: grouped ? grouped[0] : null,
                fields,
                floor: refresh ? refresh.min : null,
                about: cfg.widgetTypeAbout('cpu'),
            };
        });

        expect(shape.offered).toBe(true);
        // A type in no group never appears in the catalogue at all.
        expect(shape.group).toBe('system');
        expect(shape.fields).toEqual(['refreshSeconds', 'showLoad', 'showCores']);
        // One second: below that the delta between two /proc reads is noise.
        expect(shape.floor).toBe(1);
        expect(shape.about).toBeTruthy();
    });

    /*
     * The tile can only report the machine once somebody has mounted it in,
     * and by the time the tile says so the reader is on the dashboard rather
     * than anywhere the lines to copy are written down. So they sit beside the
     * settings -- folded shut, because it is a step taken once.
     */
    test('carries the mount it needs, beside its settings', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1200);

        const note = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const html = cfg.renderWidgetSetupNote('cpu');
            const box = document.createElement('div');
            box.innerHTML = html;
            const details = box.querySelector('details');
            return {
                shown: Boolean(details),
                openByDefault: details ? details.hasAttribute('open') : null,
                code: box.querySelector('code')?.textContent || '',
                text: box.textContent || '',
                // A type with nothing to set up says nothing at all.
                passive: cfg.renderWidgetSetupNote('health'),
            };
        });

        expect(note.shown).toBe(true);
        expect(note.openByDefault).toBe(false);
        // The exact lines, so they can be copied rather than transcribed.
        expect(note.code).toContain('/proc:/host/proc:ro');
        expect(note.code).toContain('NEXTDASH_HOST_PROC=/host/proc');
        // And the two deployments that are not docker-compose.
        expect(note.text).toContain('Unraid');
        expect(note.text.toLowerCase()).toContain('binary');
        expect(note.passive).toBe('');
    });

    /*
     * And it has to be readable where it lands.
     *
     * Inside the settings grid it became one narrow column beside Width and
     * Refresh, with the lines to copy wrapped down a strip -- the grid is
     * auto-fit, so `grid-column: 1 / -1` has no explicit track count to span.
     * Above the grid it is a plain block the width of the panel.
     */
    test('the setup note spans the panel rather than a grid column', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForTimeout(1500);

        // Through the real panel: a hand-built copy of the markup would keep
        // passing while the actual settings row rendered it wrongly, which is
        // exactly how this shipped narrow the first time.
        const idx = await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config._module;
            const existing = [...document.querySelectorAll('[data-widget-row]')]
                .find((li) => li.querySelector('.config-widget-row-kind')?.textContent.trim() === 'Processor');
            if (existing) return existing.getAttribute('data-widget-row');
            await cfg.addWidget('cpu');
            await new Promise((r) => setTimeout(r, 2000));
            const added = [...document.querySelectorAll('[data-widget-row]')]
                .find((li) => li.querySelector('.config-widget-row-kind')?.textContent.trim() === 'Processor');
            return added ? added.getAttribute('data-widget-row') : null;
        });
        test.skip(idx === null, 'no processor row could be opened here');

        await page.locator(`[data-widget-settings="${idx}"]`).click();
        await page.waitForTimeout(900);

        const shape = await page.evaluate((i) => {
            const row = document.querySelector(`[data-widget-row="${i}"]`);
            const note = row.querySelector('.config-widget-setup');
            const body = row.querySelector('.config-widget-settings-body');
            if (!note || !body) return null;
            return {
                noteWidth: Math.round(note.getBoundingClientRect().width),
                bodyWidth: Math.round(body.getBoundingClientRect().width),
                // Inside the auto-fit grid it becomes one narrow column.
                insideGrid: note.parentElement === body,
            };
        }, idx);

        expect(shape).not.toBeNull();
        expect(shape.insideGrid).toBe(false);
        expect(shape.noteWidth).toBe(shape.bodyWidth);
    });
});
