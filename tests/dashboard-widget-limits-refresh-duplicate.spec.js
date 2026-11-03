// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Three things a widget header and its settings now offer:
 *
 *  - where a disk or memory figure turns amber and red is the widget's own;
 *  - "Refresh now" is on every tile that keeps a clock, not only the custom one;
 *  - Duplicate makes a second copy right after the first, with its settings.
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

async function putWidgets(page, widgets) {
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({ widgets: list }) });
    }, widgets);
    await page.reload({ waitUntil: 'networkidle' });
}

const GB = 1024 ** 3;
const DISKS = {
    available: true, totalBytes: 1000 * GB, usedBytes: 600 * GB, freeBytes: 400 * GB, usedPercent: 60,
    readable: 1, unreadable: 0,
    mounts: [{
        path: '/mnt/user', label: 'Files', totalBytes: 1000 * GB, usedBytes: 600 * GB, freeBytes: 400 * GB,
        reservedBytes: 0, usedPercent: 60, inodesTotal: 0, inodesFree: 0,
    }],
};

async function diskTone(page, config) {
    await page.route('**/api/system/metrics**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ disks: DISKS }),
    }));
    return page.evaluate(async (cfg) => {
        const host = document.createElement('div');
        host.className = 'dashboard-widget';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        const d = window.dashboardInstance;
        d._widgetSystem = {};
        await window.DashboardWidgets.disks(body, { id: 'probe', type: 'disks', config: cfg }, d);
        const fill = body.querySelector('.dashboard-widget-meter-fill');
        const tone = [...fill.classList].find((c) => c.includes('--'))?.split('--')[1];
        host.remove();
        return tone;
    }, config);
}

test.describe('how full turns amber and red', () => {
    test('60% is fine by default and amber once the limit is moved below it', async ({ page }) => {
        await openDashboard(page);
        expect(await diskTone(page, {})).toBe('good');
        expect(await diskTone(page, { warnAt: 50, criticalAt: 80 })).toBe('warn');
        expect(await diskTone(page, { warnAt: 40, criticalAt: 55 })).toBe('bad');
    });

    test('a red limit at or under the amber one is ignored as a pair', async ({ page }) => {
        await openDashboard(page);
        // 60% against 50/50 would be "bad" if the pair were taken as typed.
        expect(await diskTone(page, { warnAt: 50, criticalAt: 50 })).toBe('good');
    });

    test('one limit on its own is honoured, the other follows the default', async ({ page }) => {
        await openDashboard(page);
        // 60% against amber from 97 alone: still fine, and not reset to 85/95.
        expect(await diskTone(page, { warnAt: 97 })).toBe('good');
        // Red from 55 alone: red, though the default amber (85) is above it.
        expect(await diskTone(page, { criticalAt: 55 })).toBe('bad');
    });

    test('the server keeps the two limits', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ type: 'disks', config: { mounts: ['/mnt/user'], warnAt: 70, criticalAt: 90 } }]);
        const stored = await page.evaluate(async () => (await (await fetch('/api/pages/1/blocks')).json()).widgets[0].config);
        expect(stored.warnAt).toBe(70);
        expect(stored.criticalAt).toBe(90);
    });
});

test.describe('Refresh now on a tile whose answer can be held back', () => {
    test('a media tile offers it and asks the service again, past the server copy', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ type: 'sonarr', title: 'Shows', config: { server: 'http://192.168.1.9:8989', ttl: 600 } }]);
        const asked = [];
        await page.route('**/api/widgets/sonarr**', (route) => {
            asked.push(route.request().url());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], fetchedAt: Date.now() }) });
        });
        await page.reload({ waitUntil: 'networkidle' });
        const header = page.locator('.dashboard-widget[data-widget-type="sonarr"] .category-title');
        await expect(header).toBeVisible({ timeout: 15_000 });
        expect(asked.some((u) => u.includes('refresh=1'))).toBe(false);

        await header.click({ button: 'right' });
        const menu = page.locator('#widget-context-menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        await menu.locator('[data-action="refresh"]').click();
        await expect.poll(() => asked.some((u) => u.includes('refresh=1')), { timeout: 10_000 }).toBe(true);
    });

    test('a processor tile beats every few seconds and is not offered it', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ type: 'cpu', title: 'Load' }]);
        const header = page.locator('.dashboard-widget[data-widget-type="cpu"] .category-title');
        await expect(header).toBeVisible({ timeout: 15_000 });
        await header.click({ button: 'right' });
        await expect(page.locator('#widget-context-menu')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#widget-context-menu [data-action="refresh"]')).toHaveCount(0);
    });

    test('weather, which sits behind a server copy, is not offered it', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ type: 'weather', title: 'Sky' }]);
        const header = page.locator('.dashboard-widget[data-widget-type="weather"] .category-title');
        await expect(header).toBeVisible({ timeout: 15_000 });
        await header.click({ button: 'right' });
        await expect(page.locator('#widget-context-menu')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#widget-context-menu [data-action="refresh"]')).toHaveCount(0);
    });
});

test.describe('Duplicate', () => {
    test('makes a copy right after the source, titled and with the same settings', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [
            { type: 'disks', title: 'Storage', config: { mounts: ['/mnt/user'], warnAt: 70, criticalAt: 90 } },
            { type: 'health', title: 'Status' },
        ]);
        const header = page.locator('.dashboard-widget[data-widget-type="disks"] .category-title').first();
        await expect(header).toBeVisible({ timeout: 15_000 });
        await header.click({ button: 'right' });
        const menu = page.locator('#widget-context-menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        await menu.locator('[data-action="duplicate"]').click();

        await expect(page.locator('.dashboard-widget[data-widget-type="disks"]')).toHaveCount(2, { timeout: 15_000 });
        const stored = await page.evaluate(async () => (await (await fetch('/api/pages/1/blocks')).json()));
        expect(stored.widgets.map((w) => w.title)).toEqual(['Storage', 'Storage (copy)', 'Status']);
        expect(stored.widgets[1].config.warnAt).toBe(70);
        expect(stored.widgets[1].id).not.toBe(stored.widgets[0].id);
        const at = (id) => stored.order.indexOf(id);
        expect(at(stored.widgets[1].id)).toBe(at(stored.widgets[0].id) + 1);
    });
});

test.describe('Tabs', () => {
    const IDS = { a: 'w_aaaaaaaaaaaa', b: 'w_bbbbbbbbbbbb', s: 'w_cccccccccccc' };
    async function withAStack(page) {
        await openDashboard(page);
        await putWidgets(page, [
            { id: IDS.a, type: 'notes', title: 'Scratch', config: { text: 'alpha note' } },
            { id: IDS.b, type: 'notes', title: 'Todo', config: { text: 'beta note' } },
            { id: IDS.s, type: 'stack', title: 'Pad', config: { members: [IDS.a, IDS.b] } },
        ]);
        await expect(page.locator('.dashboard-widget[data-widget-type="stack"]')).toBeVisible({ timeout: 15_000 });
    }

    test('the held widgets leave the grid and show as tabs, one at a time', async ({ page }) => {
        await withAStack(page);
        // Only the stack is a block of the grid; its two notes are not.
        await expect(page.locator('.dashboard-widget')).toHaveCount(1);
        const tabs = page.locator('.dashboard-stack-tab');
        await expect(tabs).toHaveText(['Scratch', 'Todo']);
        await expect(page.locator('.dashboard-stack-panel')).toContainText('alpha note');

        await tabs.nth(1).click();
        await expect(page.locator('.dashboard-stack-panel')).toContainText('beta note');
        await expect(page.locator('.dashboard-stack-panel')).not.toContainText('alpha note');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    });

    test('the arrow keys move between tabs and the open tab is remembered', async ({ page }) => {
        await withAStack(page);
        const tabs = page.locator('.dashboard-stack-tab');
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
        await page.reload({ waitUntil: 'networkidle' });
        await expect(page.locator('.dashboard-stack-tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    });

    test('switching the stack off puts its widgets back in the grid', async ({ page }) => {
        await withAStack(page);
        await putWidgets(page, [
            { id: IDS.a, type: 'notes', title: 'Scratch', config: { text: 'alpha note' } },
            { id: IDS.b, type: 'notes', title: 'Todo', config: { text: 'beta note' } },
            { id: IDS.s, type: 'stack', title: 'Pad', config: { members: [IDS.a, IDS.b], enabled: false } },
        ]);
        await expect(page.locator('.dashboard-widget[data-widget-type="notes"]')).toHaveCount(2, { timeout: 15_000 });
        await expect(page.locator('.dashboard-widget[data-widget-type="stack"]')).toHaveCount(0);
    });

    test('Config offers the other widgets of the page as tabs, never a stack', async ({ page }) => {
        await withAStack(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await expect.poll(() => page.evaluate(
            () => (window.dashboardInstance.config._module?._widgetBlocks || []).length)).toBeGreaterThan(0);
        const options = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const index = cfg._widgetBlocks.findIndex((b) => b.type === 'stack');
            return cfg.widgetSiblingOptions(index).map(([id, name]) => `${id}|${name}`);
        });
        expect(options.map((o) => o.split('|')[0]).sort()).toEqual([IDS.a, IDS.b].sort());
        expect(options.some((o) => o.includes('Scratch'))).toBe(true);
    });
});

test.describe('A widget on a schedule', () => {
    async function core(page) {
        await openDashboard(page);
    }

    test('the window follows the clock, past midnight too', async ({ page }) => {
        await core(page);
        const results = await page.evaluate(() => {
            const rc = window.dashboardInstance.renderCore;
            const at = (h, m, day = 3) => new Date(2026, 10, day, h, m); // 3 Nov 2026 is a Tuesday
            const day = { config: { showDays: ['tue'] } };
            const window8to9 = { config: { showFrom: '08:00', showUntil: '09:00' } };
            const overnight = { config: { showFrom: '22:00', showUntil: '06:00' } };
            return {
                noSchedule: rc.widgetIsScheduledNow({ config: {} }, at(3, 0)),
                inWindow: rc.widgetIsScheduledNow(window8to9, at(8, 30)),
                atEndIsOut: rc.widgetIsScheduledNow(window8to9, at(9, 0)),
                before: rc.widgetIsScheduledNow(window8to9, at(7, 59)),
                lateNight: rc.widgetIsScheduledNow(overnight, at(23, 30)),
                earlyMorning: rc.widgetIsScheduledNow(overnight, at(5, 59)),
                midday: rc.widgetIsScheduledNow(overnight, at(12, 0)),
                rightDay: rc.widgetIsScheduledNow(day, at(12, 0, 3)),
                wrongDay: rc.widgetIsScheduledNow(day, at(12, 0, 4)),
                // Tuesday 22:00-02:00: still on at Wednesday 01:00, off at Wednesday 23:00.
                overnightTail: rc.widgetIsScheduledNow({ config: { showDays: ['tue'], showFrom: '22:00', showUntil: '02:00' } }, at(1, 0, 4)),
                overnightNextEvening: rc.widgetIsScheduledNow({ config: { showDays: ['tue'], showFrom: '22:00', showUntil: '02:00' } }, at(23, 0, 4)),
            };
        });
        expect(results).toEqual({
            noSchedule: true, inWindow: true, atEndIsOut: false, before: false,
            lateNight: true, earlyMorning: true, midday: false, rightDay: true, wrongDay: false,
            overnightTail: true, overnightNextEvening: false,
        });
    });

    test('a widget off today is not on the grid, and is back when the day is allowed', async ({ page }) => {
        await core(page);
        const today = await page.evaluate(() => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()]);
        const other = today === 'mon' ? 'tue' : 'mon';
        await putWidgets(page, [{ type: 'notes', title: 'Mornings', config: { text: 'x', showDays: [other] } }]);
        await expect(page.locator('.dashboard-widget[data-widget-type="notes"]')).toHaveCount(0);
        await putWidgets(page, [{ type: 'notes', title: 'Mornings', config: { text: 'x', showDays: [today, other] } }]);
        await expect(page.locator('.dashboard-widget[data-widget-type="notes"]')).toHaveCount(1, { timeout: 15_000 });
    });

    test('Config offers the window and the days on every widget', async ({ page }) => {
        await core(page);
        await putWidgets(page, [{ type: 'health', title: 'Status' }]);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await expect.poll(() => page.evaluate(
            () => (window.dashboardInstance.config._module?._widgetBlocks || []).length)).toBeGreaterThan(0);
        const html = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            return cfg.renderWidgetSettings(cfg._widgetBlocks[0], 0);
        });
        expect(html).toContain('data-widget-setting="showFrom"');
        expect(html).toContain('data-widget-setting="showUntil"');
        expect(html).toContain('data-widget-setting="showDays"');
    });

    test('a media widget has them too', async ({ page }) => {
        await core(page);
        await putWidgets(page, [{ type: 'sonarr', title: 'Shows', config: { server: 'http://192.168.1.9:8989' } }]);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await expect.poll(() => page.evaluate(
            () => (window.dashboardInstance.config._module?._widgetBlocks || []).length)).toBeGreaterThan(0);
        const html = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            return cfg.renderWidgetSettings(cfg._widgetBlocks[0], 0);
        });
        expect(html).toContain('data-widget-setting="showFrom"');
        expect(html).toContain('data-widget-setting="showDays"');
    });

    test('a widget off its schedule is no tab of a stack', async ({ page }) => {
        await core(page);
        const today = await page.evaluate(() => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()]);
        const other = today === 'mon' ? 'tue' : 'mon';
        await putWidgets(page, [
            { id: 'w_aaaaaaaaaaaa', type: 'notes', title: 'Now', config: { text: 'a' } },
            { id: 'w_bbbbbbbbbbbb', type: 'notes', title: 'Later', config: { text: 'b', showDays: [other] } },
            { id: 'w_cccccccccccc', type: 'stack', title: 'Pad', config: { members: ['w_aaaaaaaaaaaa', 'w_bbbbbbbbbbbb'] } },
        ]);
        await expect(page.locator('.dashboard-stack-tab')).toHaveText(['Now'], { timeout: 15_000 });
    });
});
