// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time Glances page tour: shown the first time the page opens, unless
 * the tip has already been marked seen. The same shape as
 * containers-tutorial.spec.js, over the Glances page with every Glances answer
 * mocked (the tour is drawn, so it needs no data).
 *
 * Every other spec gets the tip seen from the fixture, so it never lands on a
 * page they want to click; this file is the one place that asks for it.
 */

const STEPS = 6;
const TIP = 'glancesTutorialV1';

async function mockGlances(page) {
    await page.route('**/api/glances/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/glances\//, '');
        let body = { available: false };
        if (path === 'status') {
            body = { enabled: true, configured: true, hostConfigured: true, refresh: 2, hiddenBlocks: [], thresholds: null, level: 'ok', ok: true, at: 1, id: 'main', name: 'Home', hosts: [] };
        } else if (path === 'pluginslist') {
            body = ['quicklook'];
        } else if (path === 'history') {
            body = { names: [], series: {}, incidents: [], restarts: [] };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}

async function openPageWithTourUnseen(page) {
    await mockGlances(page);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate((tip) => {
        const d = window.dashboardInstance;
        d.settings.enableSessionTips = true;
        window.__e2eWantTours = [tip];
        const state = window.DiscoverabilityState;
        // Forgotten, not only left out: a tip marked on this page outlives an init.
        state.forgetTip(tip, { persist: false });
        const exported = state.exportState();
        exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
        state.init(exported);
    }, TIP);
    await page.evaluate(() => window.dashboardInstance.glances.openGlancesView({}));
    await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible({ timeout: 15_000 });
}

const modal = (page) => page.locator('#app-modal.show .glances-tutorial-modal');
const next = (page) => page.locator('.modal-actions .modal-button').first();

test.describe('glances page tour', () => {
    test('shows on the first visit, with six steps and a drawn scene', async ({ page }) => {
        await openPageWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await expect(page.locator('.glances-tutorial-progress')).toHaveText(`Step 1 of ${STEPS}`);
        await expect(page.locator('.glances-tutorial-dot')).toHaveCount(STEPS);
        await expect(page.locator('.glances-tutorial-scene svg.gtv')).toHaveCount(1);
    });

    test('Next walks every step, and finishing marks it seen', async ({ page }) => {
        await openPageWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        const titles = [];
        for (let i = 0; i < STEPS; i += 1) {
            titles.push((await page.locator('.glances-tutorial-step-title').textContent())?.trim());
            await expect(page.locator('.glances-tutorial-scene svg.gtv')).toHaveCount(1);
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.glances-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
            }
        }
        expect(titles).toEqual([
            'One machine, at a glance',
            'Every section, one key',
            'A row opens a side panel',
            'A record of its own',
            'Red bands are incidents',
            'More machines, and the Containers view',
        ]);
        await expect(next(page)).toHaveText('Got it');
        await next(page).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);
    });

    test('does not show again once seen', async ({ page }) => {
        await openPageWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);

        await page.evaluate(() => window.dashboardInstance.glances.closeGlancesView());
        await page.evaluate(() => window.dashboardInstance.glances.openGlancesView({}));
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        // A fixed wait: the tour must not open, so there is nothing to wait for.
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    test('respects enableSessionTips: false', async ({ page }) => {
        await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate((tip) => {
            window.dashboardInstance.settings.enableSessionTips = false;
            window.__e2eWantTours = [tip];
            const state = window.DiscoverabilityState;
            state.forgetTip(tip, { persist: false });
            const exported = state.exportState();
            exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
            state.init(exported);
        }, TIP);
        await page.evaluate(() => window.dashboardInstance.glances.openGlancesView({}));
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    // A session that has done the tour does not pay for its script again.
    test('the tour script is not fetched once the tip is seen', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => { if (r.url().includes('glances-tutorial.js')) requested.push(r.url()); });
        await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.glances.openGlancesView({}));
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        await page.waitForTimeout(700);
        expect(requested).toEqual([]);
    });

    test('Tour in the header opens it again, seen or not, first among the header buttons', async ({ page }) => {
        await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.glances.openGlancesView({}));
        await expect(page.locator('#dashboard-layout.glances-layout [data-glances-body]')).toBeVisible();
        const tour = page.locator('[data-glances-tour]');
        await expect(tour).toHaveText('Tour');
        // The same place as the Containers and Bookmarks views: the first button of the header band.
        const first = page.locator('.lvs-header-actions').first().locator('button, a').first();
        await expect(first).toHaveAttribute('data-glances-tour', '');
        await tour.click();
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
    });

    test('Config → Help and Config → Glances play it too', async ({ page }) => {
        await mockGlances(page);
        await markWhatsNewSeen(page);
        await page.goto('/#config/help/glances');
        await expect(page.locator('#config-help-body')).toBeVisible({ timeout: 15_000 });
        await page.locator('[data-overview-go*="glancesTutorialV1"]').click();
        await expect(modal(page)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('glances');
    });
});
