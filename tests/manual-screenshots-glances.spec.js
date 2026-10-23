// @ts-check
/*
 * The Glances screenshots in MANUAL.md, taken through the real UI.
 *
 * Run on purpose only, like tests/manual-screenshots.spec.js (see there for
 * the data copy and the kit this uses):
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<copy of data-demo> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-glances.spec.js
 *
 * Glances is an outside service, so every /api/glances/** answer is a fixture:
 * tests/fixtures/manual-screenshots/glances-host.json holds what a Glances 4
 * host answers (eight cores, 16 GB, five disks, twelve processes, eight
 * containers) and glances-state.json what nextDash itself says about three
 * hosts, plus the recipe for the history points -- a daily rhythm and one
 * processor incident forty-five minutes before the browser clock.
 *
 * Shots show Glances content only: the pages are cropped to the Glances view,
 * and the widget page is a patched copy with no bookmarks at all.
 */
const {
    DESKTOP,
    test,
    prepare,
    settle,
    shot,
    snap,
    crop,
    openDashboard,
} = require('./helpers/manual-shot-kit');
const { mockGlances } = require('./helpers/glances-mock');
const { expect } = require('@playwright/test');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

/**
 * The Glances view alone, without the dashboard's header (it carries the
 * weather place and the page badges): the card, and a side panel when one is open.
 */
async function frame(page, name, withPanel = false) {
    // nextdash.cc wants whole screens, like its other feature pictures.
    if (process.env.SHOTS_FULL) {
        await shot(page, name);
        return;
    }
    const view = page.locator('#dashboard-layout.glances-layout');
    const parts = withPanel ? [view, page.locator('[data-glances-drawer]').first()] : [view];
    await view.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.mouse.move(5, 895);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(300);
    await crop(page, parts, name, 6);
}

/** The Glances page, opened with its header icon. */
async function openGlances(page, section = 'overview') {
    await prepare(page);
    await mockGlances(page);
    await openDashboard(page);
    await page.locator('#page-nav-glances-link').click();
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    // The tour is offered once on a first visit; settle closes it with Escape, as a reader would.
    await page.waitForTimeout(1_500);
    await settle(page);
    if (section !== 'overview') await page.locator(`[data-glances-section="${section}"]`).click();
    await page.waitForTimeout(800);
}

test('15a glances overview', async ({ page }) => {
    await openGlances(page);
    await expect(page.locator('[data-glances-block="figures"]')).toBeVisible();
    await frame(page, '15a-glances-overview.jpg');
});

test('15a glances processes with the side panel', async ({ page }) => {
    await openGlances(page, 'processes');
    await page.locator('[data-glances-pid]').first().waitFor();
    await page.locator('[data-glances-pid]', { hasText: 'jellyfin' }).first().click();
    await page.locator('[data-glances-drawer]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await frame(page, '15a-glances-processes.jpg', true);
});

test('15a glances history', async ({ page }) => {
    await openGlances(page, 'history');
    await page.locator('[data-glances-chart]').first().waitFor();
    await page.locator('[data-glances-incident]').first().waitFor();
    await page.waitForTimeout(800);
    await frame(page, '15a-glances-history.jpg');
});

test('15a glances incident', async ({ page }) => {
    await openGlances(page, 'history');
    await page.locator('[data-glances-incident]').first().waitFor();
    await page.locator('button[data-glances-incident]').first().click();
    await page.locator('[data-glances-drawer]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1_200);
    await frame(page, '15a-glances-incident.jpg', true);
});

test('15a glances insights', async ({ page }) => {
    await openGlances(page, 'insights');
    await page.waitForTimeout(800);
    await frame(page, '15a-glances-insights.jpg');
});

test('15a glances insights, the blocks further down', async ({ page }) => {
    await openGlances(page, 'insights');
    const day = page.locator('[data-glances-insight="day"]');
    await day.waitFor();
    await day.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(300);
    await page.mouse.move(5, 895);
    await page.waitForTimeout(300);
    await crop(page, [day], '15a-glances-insights-more.jpg', 6);
});

test('15a glances insights, the whole tab (site)', async ({ page }) => {
    test.skip(!process.env.SHOTS_FULL, 'only for nextdash.cc');
    await page.setViewportSize({ width: 1440, height: 3400 });
    await openGlances(page, 'insights');
    await page.locator('[data-glances-insight="day"]').waitFor();
    await page.waitForTimeout(800);
    await frame(page, '15a-glances-insights-full.jpg');
});

test('15a glances hosts', async ({ page }) => {
    await openGlances(page, 'hosts');
    await page.locator('[data-glances-host-row]').first().waitFor();
    await frame(page, '15a-glances-hosts.jpg');
});

test.describe('the widget', () => {
    test.use({ dataPatch: 'glances' });
    test('15a glances widget', async ({ page }) => {
        await prepare(page);
        await mockGlances(page);
        await openDashboard(page);
        await page.locator('.category, [data-widget-type]').first().waitFor();
        const last = await page.evaluate(() => window.dashboardInstance.pages.length);
        await openDashboard(page, `#${last}`);
        const tile = (type) => page.locator(`[data-widget-type="${type}"]`);
        const meters = tile('glances').filter({ has: page.locator('a[href$="host=main"]') });
        const graph = tile('glances').filter({ has: page.locator('a[href$="host=vps"]') });
        await expect(graph.locator('svg.dashboard-widget-glances-spark path')).toBeVisible();
        await expect(meters).toContainText('homelab');
        await page.waitForTimeout(1_000);
        await snap(page, [meters, graph, tile('cpu').first(), tile('memory').first()], '15a-glances-widget.jpg', { pad: 10 });
    });
});

test('15a glances config', async ({ page }) => {
    await prepare(page);
    await mockGlances(page);
    await openDashboard(page);
    await page.evaluate(() => { window.location.hash = '#config/glances'; });
    await page.locator('[data-glances-field="server"]').waitFor();
    await page.waitForTimeout(1_000);
    await settle(page);
    await snap(page, page.locator('#config-glances-body'), '15a-glances-config.jpg', { pad: 12 });
});
