// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time Bookmarks view tour — shown the first time the view opens,
 * unless the tip has already been marked seen.
 *
 * Every other spec marks it seen through dismissBlockingOverlays(), so it never
 * lands on a list they want to click; this file is the one place that leaves
 * it unseen, to exercise the tour itself.
 */

const STEPS = 10;
const TIP = 'bookmarksTutorialV1';

async function openLibraryWithTourUnseen(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate((tip) => {
        const d = window.dashboardInstance;
        d.settings.enableSessionTips = true;
        window.__e2eWantBookmarksTour = true;
        const state = window.DiscoverabilityState;
        const exported = state.exportState();
        exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
        state.init(exported);
    }, TIP);
    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
    await expect(page.locator('#config-bm-list')).toBeVisible({ timeout: 15_000 });
}

const modal = (page) => page.locator('#app-modal.show .bookmarks-tutorial-modal');
const next = (page) => page.locator('.modal-actions .modal-button').first();

test.describe('bookmarks view tutorial', () => {
    test('shows on the first visit, with ten steps', async ({ page }) => {
        await openLibraryWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await expect(page.locator('.bookmarks-tutorial-progress')).toHaveText(`Step 1 of ${STEPS}`);
        await expect(page.locator('.bookmarks-tutorial-dot')).toHaveCount(STEPS);
        await expect(page.locator('.bookmarks-tutorial-scene svg.btv')).toHaveCount(1);
    });

    test('Next walks every step, and finishing marks it seen', async ({ page }) => {
        await openLibraryWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        const titles = [];
        for (let i = 0; i < STEPS; i += 1) {
            titles.push((await page.locator('.bookmarks-tutorial-step-title').textContent())?.trim());
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.bookmarks-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
            }
        }
        expect(titles).toEqual([
            'Your whole collection, one screen',
            'The rail: filters that count',
            'Three ways to check a link',
            'A failure says why',
            'Pages that change behind your back',
            'Every chart for one bookmark',
            'Collection health',
            'Hear about it when it breaks',
            'Clear the backlog',
            'The keys, and where this tour lives',
        ]);
        await expect(next(page)).toHaveText('Got it');
        await next(page).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);
    });

    test('does not show again once seen', async ({ page }) => {
        await openLibraryWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await expect(page.locator('#config-bm-list')).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    test('respects enableSessionTips: false', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate((tip) => {
            window.dashboardInstance.settings.enableSessionTips = false;
            window.__e2eWantBookmarksTour = true;
            const state = window.DiscoverabilityState;
            const exported = state.exportState();
            exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
            state.init(exported);
        }, TIP);
        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await expect(page.locator('#config-bm-list')).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    // A session that has done the tour does not pay for its script again.
    test('the tour script is not fetched once the tip is seen', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => { if (r.url().includes('bookmarks-tutorial.js')) requested.push(r.url()); });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await expect(page.locator('#config-bm-list')).toBeVisible();
        await page.waitForTimeout(700);
        expect(requested).toEqual([]);
    });

    test('Tour in the band opens it again, seen or not', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await expect(page.locator('#config-bm-list')).toBeVisible();
        await page.waitForTimeout(500);
        await expect(modal(page)).toHaveCount(0);

        await page.locator('[data-bm-tour]').click();
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
        await openLibraryWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        const running = () => page.evaluate(() =>
            [...document.querySelectorAll('.bookmarks-tutorial-scene .btv-anim')]
                .filter((n) => getComputedStyle(n).animationName !== 'none').length);

        for (let i = 0; i < STEPS; i += 1) {
            expect(await running(), `step ${i + 1} has a moving part`).toBeGreaterThan(0);
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.bookmarks-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
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
        await openLibraryWithTourUnseen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        await page.evaluate(() => {
            const lang = window.dashboardInstance.language;
            const orig = lang.t.bind(lang);
            lang.t = (k) => (/^(config\.bm|config\.tour|dashboard\.(health|inbox))/.test(k) ? 'XX' : orig(k));
            window.BookmarksTutorial.open();
        });
        const words = new Set();
        for (let i = 0; i < STEPS; i += 1) {
            (await page.locator('.bookmarks-tutorial-scene text').allTextContents()).forEach((w) => words.add(w.trim()));
            if (i < STEPS - 1) {
                await next(page).click();
                await page.waitForTimeout(80);
            }
        }
        // An address in the picture is an address, not a label.
        const english = [...words].filter((w) => !w.startsWith('#')).filter((w) =>
            /\b(broken|content|stale|monitor|periodic|off|healthy|score|uptime|checked|days?|hours?|expectations|moved|retitled|changed|charts|search|delete|snooze|skip|tour|work through|muted|browser|start|link)\b/i.test(w));
        expect(english).toEqual([]);
    });
});
