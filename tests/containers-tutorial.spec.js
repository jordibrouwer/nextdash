// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen } = require('./e2e-helpers');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The one-time Containers view tour — shown the first time the view opens,
 * unless the tip has already been marked seen. The same shape as
 * containers-tutorial.spec.js, over the Containers view with Docker mocked.
 *
 * Every other spec gets the tip seen from the fixture, so it never lands on a
 * list they want to click; this file is the one place that asks for it.
 */

const STEPS = 13;
const TIP = 'containersTutorialV2';

async function openViewWithTourUnseen(page, { sawEarlier = false } = {}) {
    await mockDocker(page);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(({ tip, sawEarlier }) => {
        const d = window.dashboardInstance;
        d.settings.enableSessionTips = true;
        window.__e2eWantTours = ['containersTutorialV2'];
        const state = window.DiscoverabilityState;
        const exported = state.exportState();
        exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip && id !== 'containersTutorialV1');
        if (sawEarlier) exported.seenTips.push('containersTutorialV1');
        state.init(exported);
    }, { tip: TIP, sawEarlier });
    await page.evaluate(() => window.dashboardInstance.docker.openDockerView());
    await expect(page.locator('[data-docker-row]').first()).toBeVisible({ timeout: 15_000 });
}

const modal = (page) => page.locator('#app-modal.show .containers-tutorial-modal');
const next = (page) => page.locator('.modal-actions .modal-button').first();

test.describe('containers view tutorial', () => {
    test('shows on the first visit, with thirteen steps', async ({ page }) => {
        await openViewWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await expect(page.locator('.containers-tutorial-progress')).toHaveText(`Step 1 of ${STEPS}`);
        await expect(page.locator('.containers-tutorial-dot')).toHaveCount(STEPS);
        await expect(page.locator('.containers-tutorial-scene svg.ctv')).toHaveCount(1);
    });

    test('Next walks every step, and finishing marks it seen', async ({ page }) => {
        await openViewWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        const titles = [];
        for (let i = 0; i < STEPS; i += 1) {
            titles.push((await page.locator('.containers-tutorial-step-title').textContent())?.trim());
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.containers-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
            }
        }
        expect(titles).toEqual([
            'Everything that runs, one screen',
            'Read the state at a glance',
            'Your columns, your order',
            'Start, stop, restart, update',
            'Actions are yours to switch on',
            'One container, four tabs',
            'A web UI and its bookmark',
            'Know when an image is out of date',
            'Updates at night, rolled back if they fail',
            'Logs, live',
            'What the disk holds',
            'Config → Containers',
            'On the dashboard, and where this tour lives',
        ]);
        await expect(next(page)).toHaveText('Got it');
        await next(page).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);
    });

    test('does not show again once seen', async ({ page }) => {
        await openViewWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);

        await page.evaluate(() => window.dashboardInstance.docker.closeDockerView());
        await page.evaluate(() => window.dashboardInstance.docker.openDockerView());
        await expect(page.locator('[data-docker-row]').first()).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    test('respects enableSessionTips: false', async ({ page }) => {
        await mockDocker(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate((tip) => {
            window.dashboardInstance.settings.enableSessionTips = false;
            window.__e2eWantTours = ['containersTutorialV2'];
            const state = window.DiscoverabilityState;
            const exported = state.exportState();
            exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
            state.init(exported);
        }, TIP);
        await page.evaluate(() => window.dashboardInstance.docker.openDockerView());
        await expect(page.locator('[data-docker-row]').first()).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    // A session that has done the tour does not pay for its script again.
    test('the tour script is not fetched once the tip is seen', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => { if (r.url().includes('containers-tutorial.js')) requested.push(r.url()); });
        await mockDocker(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.docker.openDockerView());
        await expect(page.locator('[data-docker-row]').first()).toBeVisible();
        await page.waitForTimeout(700);
        expect(requested).toEqual([]);
    });

    test('Tour in the band opens it again, seen or not', async ({ page }) => {
        await mockDocker(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.docker.openDockerView());
        await expect(page.locator('[data-docker-row]').first()).toBeVisible();
        await page.waitForTimeout(500);
        await expect(modal(page)).toHaveCount(0);

        await page.locator('[data-docker-tour]').click();
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
    });

    /**
     * Every scene moves -- lines draw, rings fill, a heartbeat ticks in -- and
     * every one stands still, on its finished picture, for a reader who asked
     * for less motion or switched animations off in the app.
     */
    test('the scenes animate, and stand still under reduced motion', async ({ page }) => {
        await openViewWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        const running = () => page.evaluate(() =>
            [...document.querySelectorAll('.containers-tutorial-scene .ctv-anim')]
                .filter((n) => getComputedStyle(n).animationName !== 'none').length);

        for (let i = 0; i < STEPS; i += 1) {
            expect(await running(), `step ${i + 1} has a moving part`).toBeGreaterThan(0);
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.containers-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
            }
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await running()).toBe(0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => document.body.classList.add('no-animations'));
        expect(await running()).toBe(0);
    });

    /** Labels come from the locale, so a translated view gets a translated tour. */
    test('the scenes carry no hard-coded English labels', async ({ page }) => {
        await openViewWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        await page.evaluate(() => {
            const lang = window.dashboardInstance.language;
            const orig = lang.t.bind(lang);
            lang.t = (k) => (/^(config\.tour|dashboard\.(docker|inbox))/.test(k) ? 'XX' : orig(k));
            window.ContainersTutorial.open();
        });
        const words = new Set();
        for (let i = 0; i < STEPS; i += 1) {
            (await page.locator('.containers-tutorial-scene text').allTextContents()).forEach((w) => words.add(w.trim()));
            if (i < STEPS - 1) {
                await next(page).click();
                await page.waitForTimeout(80);
            }
        }
        // An address in the picture is an address, not a label.
        const english = [...words].filter((w) => !w.startsWith('#')).filter((w) =>
            /\b(running|stopped|paused|unhealthy|update|restart|restarting|pause|remove|search|memory|network|overview|resources|logs|cancel|hidden|refresh|actions|socket|token|tour|off|days?|containers)\b/i.test(w));
        expect(english).toEqual([]);
    });
});

// The tour grew with v1.15.6. Whoever took the earlier tour sees it once more,
// told on the first step that it is an update, with the new steps marked; a
// first-time reader just gets the tour.
test.describe('the updated tour', () => {
    test('someone who took the earlier tour is told it is an update', async ({ page }) => {
        await openViewWithTourUnseen(page, { sawEarlier: true });
        await expect(modal(page)).toBeVisible();
        const note = page.locator('[data-tour-update]');
        await expect(note).toBeVisible();
        await expect(note).toContainText('Updated with new features');
        await expect(page.locator('[data-tour-new]')).toHaveCount(0);
        await next(page).click();
        await next(page).click();
        await expect(page.locator('.containers-tutorial-step-title')).toHaveText('Your columns, your order');
        await expect(page.locator('[data-tour-new]')).toHaveText('New');
        await expect(page.locator('[data-tour-update]')).toHaveCount(0);
    });

    test('a first-time reader gets no update note', async ({ page }) => {
        await openViewWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await expect(page.locator('[data-tour-update]')).toHaveCount(0);
    });
});
