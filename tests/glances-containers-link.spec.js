// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Glances inside the Containers view, when Config → Glances says the Glances
 * host is the machine whose Docker the view manages: a container's Resources
 * tab shows what Glances recorded about it, with its restarts marked, and a
 * button leads back to it on the Glances page. Not one machine: nothing shows.
 */

const STATUS = { enabled: true, configured: true, refresh: 2, hiddenBlocks: [], thresholds: null, level: 'ok', ok: true, at: 1, paused: false, recordEvery: 30 };
const LINK = {
    mode: 'auto', same: true, reason: 'same-name', glancesHost: 'nas', dockerHost: 'nas',
    matches: [{ glances: 'sonarr-glances', docker: 'sonarr', dockerId: 'abc', by: 'id' }],
    onlyGlances: [], onlyDocker: [], byId: 1, byName: 0,
};

async function mockGlancesLink(page, { link = LINK, recorded = true } = {}) {
    const state = { tracked: [], saved: null, histories: [] };
    await page.route('**/api/glances/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const rest = url.pathname.replace(/^\/api\/glances\//, '');
        let body = { available: false };
        if (rest === 'status') body = STATUS;
        else if (rest === 'docker-link') body = link;
        else if (rest === 'config' && request.method() === 'PUT') {
            state.saved = JSON.parse(request.postData() || '{}');
            state.tracked = state.saved.trackedHistory || [];
            body = { enabled: true, trackedHistory: state.tracked };
        } else if (rest === 'config') body = { enabled: true, trackedHistory: state.tracked };
        else if (rest === 'history') {
            state.histories.push(url.search);
            const asked = (url.searchParams.get('series') || '').split(',').filter(Boolean);
            const since = Number(url.searchParams.get('since')) || Date.now() - 3600000;
            const series = {};
            if (recorded) {
                asked.forEach((name, k) => { series[name] = Array.from({ length: 30 }, (_, i) => [since + i * 120000, 5 + ((i * 3 + k) % 20)]); });
            }
            body = { names: asked, series, step: 120, now: Date.now(), incidents: [], restarts: recorded && url.searchParams.get('restarts') ? [since + 10 * 120000] : [] };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    return state;
}

async function openResources(page) {
    await markWhatsNewSeen(page);
    await mockDocker(page);
    await page.goto('/#docker/sonarr');
    await page.locator('[data-docker-drawer] [data-slp-tab="resources"]').click();
}

test.describe('Glances in the Containers view', () => {
    test('same machine: what Glances recorded, with the restarts marked, and a way back', async ({ page }) => {
        const state = await mockGlancesLink(page);
        await openResources(page);
        const embed = page.locator('[data-glances-embed="sonarr-glances"]');
        await expect(embed).toBeVisible();
        await expect(embed).toContainText('From Glances');
        await expect(embed.locator('[data-glances-chart]')).toHaveCount(3);
        // The history of the Glances name, with the restarts of the Docker name asked for.
        await expect.poll(() => state.histories.some((q) => q.includes('ct%3Asonarr-glances%3Acpu') && q.includes('restarts=sonarr'))).toBe(true);
        await expect(embed.locator('[data-glances-restart]').first()).toBeAttached();
        // The way back: the container on the Glances page.
        await embed.locator('[data-glances-embed-open]').click();
        await expect.poll(() => page.evaluate(() => window.__glancesOpenContainer)).toBe('sonarr-glances');
        await expect(page).toHaveURL(/#glances/);
    });

    test('not one machine: nothing is drawn', async ({ page }) => {
        await mockGlancesLink(page, { link: { ...LINK, same: false, reason: 'different-name', matches: [] } });
        await openResources(page);
        await expect(page.locator('[data-docker-cpu]')).toBeVisible();
        await page.waitForTimeout(600);
        await expect(page.locator('[data-glances-embed]')).toHaveCount(0);
        await expect(page.locator('.docker-glances')).toBeHidden();
    });

    test('a container Glances has no record of yet offers to start recording it', async ({ page }) => {
        const state = await mockGlancesLink(page, { recorded: false });
        await openResources(page);
        const embed = page.locator('[data-glances-embed="sonarr-glances"]');
        await expect(embed.locator('[data-glances-embed-empty]')).toBeVisible();
        await embed.locator('[data-glances-embed-record]').click();
        await expect.poll(() => state.tracked).toEqual(['ct:sonarr-glances']);
        await expect(embed.locator('[data-glances-embed-empty]')).toContainText('Recording started');
    });
});
