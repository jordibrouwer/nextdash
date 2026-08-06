// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Exporting recorded uptime samples.
 *
 * The samples are the one thing the monitor produces that cannot be recomputed —
 * a 30-day window takes 30 days to earn back — and they never reach the client:
 * the health report carries only derived numbers. So the export is a server
 * endpoint, and the buttons are navigations to it rather than a CSV built here.
 */

async function openHealth(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/#health');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.health, null, { timeout: 20_000 });
}

/** Open the health view already on a given filter, via its deep link. */
async function openHealthFiltered(page, filter) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto(`/?hv_filter=${filter}#health`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.health, null, { timeout: 20_000 });
    await page.waitForSelector('.health-view-export-btn', { timeout: 15_000 });
}

/** Parse a CSV body the way a spreadsheet would, BOM stripped. */
function parseCsv(text) {
    const body = text.replace(/^﻿/, '');
    return body.trim().split(/\r?\n/).map((line) => {
        const cells = [];
        let cur = '';
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
                else if (ch === '"') { quoted = false; }
                else { cur += ch; }
            } else if (ch === '"') { quoted = true; }
            else if (ch === ',') { cells.push(cur); cur = ''; }
            else { cur += ch; }
        }
        cells.push(cur);
        return cells;
    });
}

test.describe('uptime history export', () => {
    test('the endpoint returns a CSV attachment with a header row', async ({ page }) => {
        await openHealth(page);

        const res = await page.request.get('/api/health/history-export');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('text/csv');
        expect(res.headers()['content-disposition']).toContain('attachment;');
        // The filename carries the date so successive exports do not overwrite.
        expect(res.headers()['content-disposition']).toMatch(/nextdash-uptime-\d{4}-\d{2}-\d{2}\.csv/);

        const rows = parseCsv(await res.text());
        expect(rows[0]).toEqual(['name', 'url', 'page', 'timestamp', 'up', 'pingMs', 'httpStatus']);
    });

    test('the body starts with a UTF-8 BOM so Excel reads it correctly', async ({ page }) => {
        await openHealth(page);
        const res = await page.request.get('/api/health/history-export');
        expect((await res.text()).charCodeAt(0)).toBe(0xFEFF);
    });

    test('an unknown URL is a 404 and a bad day window is a 400', async ({ page }) => {
        await openHealth(page);

        const missing = await page.request.get(
            '/api/health/history-export?url=' + encodeURIComponent('https://not-monitored.example')
        );
        expect(missing.status()).toBe(404);

        for (const bad of ['0', '-1', 'abc']) {
            const res = await page.request.get(`/api/health/history-export?days=${bad}`);
            expect(res.status(), `days=${bad}`).toBe(400);
        }

        // Over-long windows are clamped, not rejected: asking for a year of a
        // 30-day retention should return what exists.
        const clamped = await page.request.get('/api/health/history-export?days=365');
        expect(clamped.status()).toBe(200);
    });

    test('the export is reachable without a write token', async ({ page }) => {
        await openHealth(page);
        // Reading measurements is not a mutation, so it must not sit behind the
        // write token the way delete and restore do.
        const res = await page.request.get('/api/health/history-export');
        expect(res.status()).toBe(200);
    });

    test('the toolbar offers history export only on the Monitored filter', async ({ page }) => {
        // The deep link is the filter's own entry point — the same one the health
        // badge uses for an outage.
        await openHealthFiltered(page, 'all');
        await expect(page.locator('.health-view-history-export-btn')).toHaveCount(0);
        // The row-list export stays available everywhere; the two are different
        // exports and must not be confused for one another.
        await expect(page.locator('.health-view-export-btn')).toHaveCount(1);

        await openHealthFiltered(page, 'monitored');
        await expect(page.locator('.health-view-history-export-btn')).toHaveCount(1);
    });

    test('the toolbar button downloads the CSV', async ({ page }) => {
        await openHealthFiltered(page, 'monitored');
        await page.locator('.health-view-history-export-btn').waitFor({ state: 'visible' });

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15_000 }),
            page.locator('.health-view-history-export-btn').click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/nextdash-uptime-.*\.csv/);
    });

    test('an empty history still yields a parseable header-only CSV', async ({ page }) => {
        await openHealth(page);

        // The shipped fixture records no samples, so this is the state a fresh
        // install exports from: a valid file with nothing in it, not an error.
        const res = await page.request.get('/api/health/history-export');
        expect(res.status()).toBe(200);
        const rows = parseCsv(await res.text());
        expect(rows).toHaveLength(1);
        expect(rows[0][0]).toBe('name');
        expect(res.headers()['x-nextdash-rows']).toBe('0');
    });
});
