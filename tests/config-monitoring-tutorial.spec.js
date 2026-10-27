// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The one-time Monitoring tour.
 *
 * Config → Monitoring opens on a tab of check settings, and none of it reads
 * until you know that checking is chosen per bookmark -- Off, Periodic or
 * Monitor -- and that alerts and schedules concern the monitored ones. Built
 * and offered exactly like the Widgets tour: once, on the first visit to the
 * section, and on request from its Tour button, Config's tour list and :tour.
 */

const TIP = 'monitoringTutorialV1';
const STEPS = 5;

async function openDashboard(page, { width = 1400, height = 900 } = {}) {
    await page.setViewportSize({ width, height });
    // The fixture keeps this tour seen in every spec unless one asks for it.
    await page.addInitScript((tip) => { window.__e2eWantTours = [tip]; }, TIP);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The helpers above mark it seen for everyone else; put it back to unseen.
    await page.evaluate((tip) => {
        const state = window.DiscoverabilityState;
        window.dashboardInstance.settings.enableSessionTips = true;
        state.forgetTip?.(tip, { persist: false });
        const exported = state.exportState();
        exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
        state.init?.(exported);
        // Analytics, kept for the assertions: fixed words only.
        window.__tracked = [];
        const original = window.nextdashTrack;
        window.nextdashTrack = (name, props) => {
            window.__tracked.push({ name, props: props || null });
            return original?.(name, props);
        };
    }, TIP);
}

const openMonitoring = (page) => page.evaluate(async () => {
    await window.dashboardInstance.config.openConfigView('monitoring');
});

const tour = (page) => page.locator('#app-modal.show .monitoring-tutorial-modal');
const progress = (page) => page.locator('#app-modal.show .monitoring-tutorial-progress');
const confirmButton = (page) => page.locator('#app-modal.show .modal-actions .modal-button').first();
const cancelButton = (page) => page.locator('#app-modal.show .modal-actions .modal-button').nth(1);
const seen = (page) => page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP);

test.describe('the monitoring tour', () => {
    // The seen-marker is written to the shared data dir; leave it as it was
    // before this feature existed.
    test.afterEach(async ({ page }) => {
        await page.evaluate(async (tip) => {
            window.DiscoverabilityState?.forgetTip?.(tip);
            await window.DiscoverabilityState?.persistNow?.();
        }, TIP).catch(() => { /* the page may already be closed */ });
    });

    test('opens the first time Monitoring does, walks Next and Back, and finishes seen', async ({ page }) => {
        await openDashboard(page);
        await openMonitoring(page);

        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        await expect(progress(page)).toHaveText(`Step 1 of ${STEPS}`);
        await expect(cancelButton(page)).toHaveText('Skip');

        // Next, then Back returns to the first step.
        await confirmButton(page).click();
        await expect(progress(page)).toHaveText(`Step 2 of ${STEPS}`);
        await expect(cancelButton(page)).toHaveText('Back');
        await cancelButton(page).click();
        await expect(progress(page)).toHaveText(`Step 1 of ${STEPS}`);

        // Every step carries a picture beside its prose.
        const steps = [];
        for (let step = 1; step <= STEPS; step += 1) {
            await expect(progress(page)).toHaveText(`Step ${step} of ${STEPS}`);
            steps.push(await page.evaluate(() => {
                const root = document.querySelector('#app-modal.show .monitoring-tutorial');
                return {
                    title: root.querySelector('.monitoring-tutorial-step-title')?.textContent?.trim() || '',
                    visual: Boolean(root.querySelector('.monitoring-tutorial-scene svg')),
                    words: (root.querySelector('.monitoring-tutorial-step-body')?.textContent || '').trim().length,
                };
            }));
            if (step === STEPS) await expect(confirmButton(page)).toHaveText('Got it');
            await confirmButton(page).click();
        }
        await expect(page.locator('#app-modal.show')).toHaveCount(0, { timeout: 10_000 });
        steps.forEach((step, i) => {
            expect(step.visual, `step ${i + 1} has no picture`).toBe(true);
            expect(step.words, `step ${i + 1} has no prose`).toBeGreaterThan(80);
        });
        expect(steps.map((s) => s.title).join(' ')).toContain('Periodic');

        expect(await seen(page)).toBe(true);
        const tracked = await page.evaluate(() => window.__tracked.filter((e) => e.name.startsWith('monitoring-tutorial:')));
        expect(tracked).toEqual([
            { name: 'monitoring-tutorial:shown', props: null },
            { name: 'monitoring-tutorial:finished', props: { outcome: 'completed', step: STEPS } },
        ]);

        // Second visit: the section is just the section.
        await page.evaluate(async () => { await window.DiscoverabilityState?.persistNow?.(); });
        await page.evaluate(async () => {
            await window.dashboardInstance.config.openConfigView('overview');
            await window.dashboardInstance.config.openConfigView('monitoring');
        });
        // A fixed wait: the tour must not come back, so there is nothing to wait for.
        await page.waitForTimeout(800);
        await expect(tour(page)).toHaveCount(0);

        // Seen or not, the Tour button on the band brings it back.
        await page.locator('[data-monitoring-tour]').click();
        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        await expect(progress(page)).toHaveText(`Step 1 of ${STEPS}`);
    });

    test('Skip on the first step and Escape later both count as seen', async ({ page }) => {
        await openDashboard(page);
        await openMonitoring(page);
        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        await cancelButton(page).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await seen(page)).toBe(true);

        await page.evaluate((tip) => window.DiscoverabilityState.forgetTip(tip, { persist: false }), TIP);
        await page.locator('[data-monitoring-tour]').click();
        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        await confirmButton(page).click();
        await expect(progress(page)).toHaveText(`Step 2 of ${STEPS}`);
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await seen(page)).toBe(true);

        const outcomes = await page.evaluate(() => window.__tracked
            .filter((e) => e.name === 'monitoring-tutorial:finished').map((e) => e.props));
        expect(outcomes).toEqual([{ outcome: 'skipped', step: 1 }, { outcome: 'dismissed', step: 2 }]);
    });

    test('the Tour button is in the slot at the right edge, and the filter stays where it is on the other tabs', async ({ page }) => {
        await openDashboard(page);
        // Seen, so nothing opens on top of the band.
        await page.evaluate((tip) => window.DiscoverabilityState.markTipSeen(tip, { persist: false }), TIP);
        await openMonitoring(page);
        const place = () => page.evaluate(() => {
            const head = document.querySelector('.config-view-head').getBoundingClientRect();
            const bar = document.querySelector('.lvs-header-actions .config-changed-bar')?.getBoundingClientRect();
            const tour = document.querySelector('[data-monitoring-tour]')?.getBoundingClientRect();
            return { head: head.right, bar: bar && bar.right, tour: tour && tour.right, tourLeft: tour && tour.left };
        });
        const monitoring = await place();
        // At the band's end, not beside the filter with the slot left empty behind it.
        // The band's own padding is 24px; the empty slot it replaces is 208px.
        expect(monitoring.head - monitoring.tour).toBeLessThanOrEqual(24.5);
        expect(monitoring.tourLeft).toBeGreaterThanOrEqual(monitoring.bar);
        // And the filter ends where it does on a tab whose slot holds the view link.
        await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('inbox'); });
        await expect(page.locator('[data-inbox-open-view]')).toBeVisible();
        const inbox = await place();
        expect(Math.abs(monitoring.bar - inbox.bar)).toBeLessThanOrEqual(1);
    });

    test('says nothing when session tips are off', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.enableSessionTips = false; });
        await openMonitoring(page);
        // A fixed wait: the tour must stay away, so there is nothing to wait for.
        await page.waitForTimeout(900);
        await expect(tour(page)).toHaveCount(0);
    });

    test('plays from :tour, seen or not', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate((tip) => window.DiscoverabilityState.markTipSeen(tip, { persist: false }), TIP);
        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        await page.keyboard.type('tour monitoring');
        await expect(page.locator('#search-query')).toContainText('tour monitoring');
        await expect(page.locator('.search-match').first()).toContainText('Monitoring');
        await page.keyboard.press('Enter');

        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.config.instance?.section)).toBe('monitoring');
    });

    test('fits a phone-width window without scrolling sideways', async ({ page }) => {
        await openDashboard(page, { width: 360, height: 760 });
        await page.evaluate((tip) => window.DiscoverabilityState.markTipSeen(tip, { persist: false }), TIP);
        await openMonitoring(page);
        // Whatever the section behind it does at this width is not the tour's;
        // the tour must not make it any wider.
        const before = await page.evaluate(() => document.documentElement.scrollWidth);
        await page.evaluate(() => window.dashboardInstance.config.instance.openMonitoringTour());
        await expect(tour(page)).toBeVisible({ timeout: 15_000 });

        for (let step = 1; step <= STEPS; step += 1) {
            await expect(progress(page)).toHaveText(`Step ${step} of ${STEPS}`);
            const sizes = await page.evaluate(() => {
                const modal = document.querySelector('#app-modal.show .modal');
                const scene = document.querySelector('#app-modal.show .monitoring-tutorial-scene');
                return {
                    page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
                    modal: [modal.scrollWidth, modal.clientWidth, Math.round(modal.getBoundingClientRect().right)],
                    scene: [scene.scrollWidth, scene.clientWidth],
                };
            });
            expect(sizes.page[0], `step ${step}: the tour widens the page`).toBeLessThanOrEqual(Math.max(before, sizes.page[1]));
            expect(sizes.modal[0], `step ${step}: the modal scrolls sideways`).toBeLessThanOrEqual(sizes.modal[1]);
            expect(sizes.modal[2], `step ${step}: the modal runs off the screen`).toBeLessThanOrEqual(360);
            expect(sizes.scene[0], `step ${step}: the picture is wider than its frame`).toBeLessThanOrEqual(sizes.scene[1]);
            if (step < STEPS) await confirmButton(page).click();
        }
    });
});
