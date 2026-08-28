// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The one-time Widgets tour.
 *
 * The Widgets tab opens on your own widgets and one button, which says nothing
 * about the two things worth knowing: that thirteen types need no setup at all,
 * and that the fourteenth reaches any address answering JSON. The second is
 * invisible from the tab — the catalogue says "Custom" and leaves the reader to
 * guess what that reaches.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The tour is one-time and the tests share a data dir, so an earlier run
    // leaves the tip seen. Put it back to unseen rather than assume.
    await page.evaluate(() => {
        const state = window.DiscoverabilityState;
        if (!state?.exportState) return;
        const exported = state.exportState();
        exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'widgetsTutorialV1');
        state.init?.(exported);
    });
}

const openWidgetsSection = (page) => page.evaluate(async () => {
    await window.dashboardInstance.config.openConfigView('widgets');
});

/** The confirm button — first in the row, Next until the last step. */
const next = async (page) => {
    await page.locator('.modal-actions .modal-button').first().click();
    await page.waitForTimeout(150);
};

test.describe('the widgets tour', () => {
    test('opens the first time the Widgets section does, and only then', async ({ page }) => {
        await openDashboard(page);
        await openWidgetsSection(page);

        const tour = page.locator('#app-modal.show .widgets-tutorial-modal');
        await expect(tour).toBeVisible({ timeout: 15_000 });
        // The animation leads, because what a custom widget does is a movement.
        await expect(tour.locator('.widgets-tutorial-hero')).toBeVisible();

        // Walk to the end and close it.
        for (let step = 0; step < 7; step += 1) {
            await next(page);
        }
        await expect(page.locator('#app-modal.show')).toHaveCount(0, { timeout: 10_000 });

        // Write the seen-marker through before reopening: the config panel
        // reloads settings when a section opens, and an init() landing with the
        // server's older copy would put the tip back to unseen — which is the
        // test's own race, not the app's.
        await page.evaluate(async () => { await window.DiscoverabilityState?.persistNow?.(); });

        // Second visit: the tab is just the tab.
        await page.evaluate(async () => {
            await window.dashboardInstance.config.openConfigView('overview');
            await window.dashboardInstance.config.openConfigView('widgets');
        });
        await page.waitForTimeout(800);
        // The modal element stays in the document once used; what matters is
        // that it is not shown again.
        await expect(page.locator('#app-modal.show .widgets-tutorial-modal')).toHaveCount(0);
    });

    test('every step carries a visual beside its prose', async ({ page }) => {
        await openDashboard(page);
        await openWidgetsSection(page);
        await expect(page.locator('#app-modal.show .widgets-tutorial-modal')).toBeVisible({ timeout: 15_000 });

        const seen = [];
        for (let step = 0; step < 7; step += 1) {
            seen.push(await page.evaluate(() => {
                const root = document.querySelector('.widgets-tutorial');
                return {
                    title: root.querySelector('.widgets-tutorial-step-title')?.textContent?.trim() || '',
                    visual: Boolean(root.querySelector('.widgets-tutorial-hero, .widgets-tutorial-visual')),
                    words: (root.querySelector('.widgets-tutorial-step-body')?.textContent || '').trim().length,
                };
            }));
            await next(page);
        }

        expect(seen).toHaveLength(7);
        seen.forEach((step, i) => {
            expect(step.visual, `step ${i + 1} has no visual`).toBe(true);
            expect(step.words, `step ${i + 1} has no prose`).toBeGreaterThan(80);
        });
        // The custom widget is the reason this tour exists, so it has to be in it.
        expect(seen.map((s) => s.title).join(' ')).toContain('JSON');
    });

    test('says nothing when session tips are off', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.enableSessionTips = false; });
        await openWidgetsSection(page);
        await page.waitForTimeout(900);

        await expect(page.locator('#app-modal.show .widgets-tutorial-modal')).toHaveCount(0);
    });
});
