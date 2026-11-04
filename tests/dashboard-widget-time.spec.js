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
        await putWidgets(page, [{ type: 'clock', title: 'World', config: { look: 'list', zones: ['Tokyo=Asia/Tokyo', 'Nowhere=Mars/Olympus'] } }]);
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
            const widget = { id: 'probe', type: 'clock', config: { look: 'list', zones: ['Asia/Tokyo'] } };
            window.DashboardWidgets.clock(body, widget, d);
            const first = body._ndTimeTimer;
            window.DashboardWidgets.clock(body, widget, d);
            const second = body._ndTimeTimer;
            body.remove();
            return { replaced: first !== second };
        });
        expect(out.replaced).toBe(true);
    });

    test('the large face shows the other places under it, three at most, and no row for here', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{
            id: 'w_dddddddddddd', type: 'clock', title: 'World',
            config: { zones: ['Tokyo=Asia/Tokyo', 'New York=America/New_York', 'Sydney=Australia/Sydney', 'Lima=America/Lima'], showDate: true },
        }]);
        const tile = page.locator('.dashboard-widget[data-widget-id="w_dddddddddddd"]');
        await expect(tile.locator('.dashboard-clock-svg')).toBeVisible({ timeout: 15_000 });
        const rows = tile.locator('.dashboard-clock-main .dashboard-widget-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('Tokyo');
        await expect(rows.nth(2)).toContainText('Sydney');
        await expect(tile.locator('.dashboard-clock-date')).toBeVisible();
    });

    test('one column shows the face and the places only; the moon and sun are for two columns', async ({ page }) => {
        await openDashboard(page);
        await putWidgets(page, [{ id: 'w_eeeeeeeeeeee', type: 'clock', config: { zones: ['Asia/Tokyo'] } }]);
        const tile = page.locator('.dashboard-widget[data-widget-id="w_eeeeeeeeeeee"]');
        await expect(tile.locator('.dashboard-clock-svg')).toBeVisible({ timeout: 15_000 });
        // Built, but hidden by width.
        await expect(tile.locator('.dashboard-clock-moon')).toHaveCount(1);
        await expect(tile.locator('.dashboard-clock-moon')).toBeHidden();
    });

    test('settings can turn the moon, the sun and the seconds hand off', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const body = document.createElement('div');
            document.body.appendChild(body);
            const widget = { id: 'probe', type: 'clock', config: { showMoon: false, showSun: false, showSeconds: false } };
            window.DashboardWidgets.clock(body, widget, d);
            const result = {
                sky: body.querySelectorAll('.dashboard-clock-sky').length,
                secondHidden: body.querySelector('.dashboard-clock-hand-second')?.style.display === 'none',
            };
            if (body._ndClockStop) body._ndClockStop();
            body.remove();
            return result;
        });
        expect(out.sky).toBe(0);
        expect(out.secondHidden).toBe(true);
    });

    test('the hands stop once the clock leaves the page, and drawing again starts one loop only', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const body = document.createElement('div');
            document.body.appendChild(body);
            const widget = { id: 'probe', type: 'clock', config: {} };
            window.DashboardWidgets.clock(body, widget, d);
            const first = body._ndClockStop;
            window.DashboardWidgets.clock(body, widget, d);
            const second = body._ndClockStop;
            body.remove();
            await new Promise((resolve) => setTimeout(resolve, 1200));
            return { replaced: first !== second, stopped: body._ndClockStop === null };
        });
        expect(out.replaced).toBe(true);
        expect(out.stopped).toBe(true);
    });

    test('the moon: a known new and full moon, and the sun in Amsterdam on a November day', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const t = window.DashboardWidgetTime;
            const newMoon = t.moonOf(new Date(Date.UTC(2026, 10, 9, 12)));
            const fullMoon = t.moonOf(new Date(Date.UTC(2026, 10, 24, 14)));
            const sun = t.sunTimes(new Date(2026, 10, 4, 12), 52.37, 4.9);
            const polar = t.sunTimes(new Date(2026, 5, 21, 12), 78.2, 15.6);
            const night = t.sunTimes(new Date(2026, 11, 21, 12), 78.2, 15.6);
            return {
                newLit: newMoon.lit, fullLit: fullMoon.lit,
                riseUtc: sun.rise.getUTCHours() * 60 + sun.rise.getUTCMinutes(),
                setUtc: sun.set.getUTCHours() * 60 + sun.set.getUTCMinutes(),
                alwaysUp: polar.always === true, neverUp: night.never === true,
            };
        });
        expect(out.newLit).toBeLessThan(0.03);
        expect(out.fullLit).toBeGreaterThan(0.97);
        // Sunrise 06:41 and sunset 16:09 UTC, give or take a few minutes.
        expect(Math.abs(out.riseUtc - (6 * 60 + 41))).toBeLessThan(6);
        expect(Math.abs(out.setUtc - (16 * 60 + 9))).toBeLessThan(6);
        expect(out.alwaysUp).toBe(true);
        expect(out.neverUp).toBe(true);
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
