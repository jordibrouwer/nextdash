// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Clock and Countdown draw from their settings and the browser's time alone.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.DashboardWidgets?.clock, null, { timeout: 20_000 });
}

async function putWidgets(page, widgets) {
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({ widgets: list }) });
    }, widgets);
    await page.reload({ waitUntil: 'networkidle' });
}

const isoDay = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('Countdown', () => {
    test('counts calendar days to a date, and days since once it has passed', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [
            { id: 'w_aaaaaaaaaaaa', type: 'countdown', title: 'Holiday', config: { date: isoDay(12) } },
            { id: 'w_bbbbbbbbbbbb', type: 'countdown', title: 'Launch', config: { date: isoDay(-3) } },
            { id: 'w_cccccccccccc', type: 'countdown', title: 'Tomorrow', config: { date: isoDay(1) } },
        ]);
        const text = async (id) => page.locator(`.dashboard-widget[data-widget-id="${id}"] .dashboard-widget-body`).innerText();
        await expect.poll(() => text('w_aaaaaaaaaaaa'), { timeout: 15_000 }).toMatch(/12\s+days left/);
        expect(await text('w_bbbbbbbbbbbb')).toMatch(/3\s+days ago/);
        expect(await text('w_cccccccccccc')).toMatch(/1\s+day left/);
    });

    test('a date that is cleared stops the old countdown from coming back', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const body = document.createElement('div');
            document.body.appendChild(body);
            const widget = { id: 'probe', type: 'countdown', title: 'X', config: { date: '2030-01-01' } };
            window.DashboardWidgets.countdown(body, widget, d);
            const had = Boolean(body._ndTimeTimer);
            widget.config = {};
            window.DashboardWidgets.countdown(body, widget, d);
            const after = body._ndTimeTimer;
            body.remove();
            return { had, after };
        });
        expect(out.had).toBe(true);
        expect(out.after).toBeNull();
    });

    test('says what is missing when there is no date', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ type: 'countdown', title: 'Nothing' }]);
        await expect(page.locator('.dashboard-widget[data-widget-type="countdown"] .dashboard-widget-body'))
            .toContainText('Pick a date', { timeout: 15_000 });
    });
});

test.describe('Clock', () => {
    test('shows here first, then each place, and marks a place that is not known', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ type: 'clock', title: 'World', config: { zones: ['Tokyo=Asia/Tokyo', 'Nowhere=Mars/Olympus'] } }]);
        const rows = page.locator('.dashboard-widget[data-widget-type="clock"] .dashboard-widget-row');
        await expect(rows).toHaveCount(3, { timeout: 15_000 });
        await expect(rows.nth(0)).toContainText('Here');
        await expect(rows.nth(1)).toContainText('Tokyo');
        await expect(rows.nth(1)).toContainText(/\d{1,2}[:.]\d{2}/);
        await expect(rows.nth(2)).toContainText('unknown zone');
    });

    test('drawing a clock again replaces its timer', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const body = document.createElement('div');
            document.body.appendChild(body);
            const widget = { id: 'probe', type: 'clock', config: { zones: ['Asia/Tokyo'] } };
            window.DashboardWidgets.clock(body, widget, d);
            const first = body._ndTimeTimer;
            window.DashboardWidgets.clock(body, widget, d);
            const second = body._ndTimeTimer;
            body.remove();
            return { replaced: first !== second };
        });
        expect(out.replaced).toBe(true);
    });

    test('the time maths: day numbers differ across the date line', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const t = window.DashboardWidgetTime;
            const at = new Date(Date.UTC(2026, 10, 3, 23, 30));
            return {
                auckland: t.dayNumber('Pacific/Auckland', at) - t.dayNumber('UTC', at),
                honolulu: t.dayNumber('Pacific/Honolulu', at) - t.dayNumber('UTC', at),
                named: t.parseZone('Tokyo=Asia/Tokyo'),
                bare: t.parseZone('America/New_York'),
            };
        });
        expect(out.auckland).toBe(1);
        expect(out.honolulu).toBe(0);
        expect(out.named).toEqual({ name: 'Tokyo', zone: 'Asia/Tokyo' });
        expect(out.bare).toEqual({ name: 'New York', zone: 'America/New_York' });
    });
});
