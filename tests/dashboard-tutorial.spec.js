// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time dashboard tour — the map of the whole app, shown once the
 * quick-start checklist is out of the way.
 *
 * Every other spec gets the tip seen from the fixture; this file asks for it
 * (window.__e2eWantTours) before the page loads, so the real start-up path is
 * the one that decides whether it opens.
 */

const STEPS = 9;
const TIP = 'dashboardTutorialV3';
const modal = (page) => page.locator('#app-modal.show .dashboard-tutorial-modal');
const next = (page) => page.locator('.modal-actions .modal-button').first();

/** Load the dashboard with the tour still to come. */
async function loadWithTourPending(page) {
    await markWhatsNewSeen(page);
    await page.addInitScript((tip) => { window.__e2eWantTours = [tip]; }, TIP);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

test.describe('dashboard tour', () => {
    test('on a fresh install it waits for its step in the start guide', async ({ page }) => {
        await loadWithTourPending(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.onboardingCompleted = false;
            if (d.settings.quickStart) d.settings.quickStart.dismissed = false;
            d.onboardingStartedInSession = true;
            d.quickStart?.start?.();
        });
        await expect(page.locator('[data-start-guide-bar]')).toBeVisible({ timeout: 10_000 });
        // Two introductions at once is one too many. A fixed wait: the tour,
        // if it were going to start, starts a moment after the bar shows, and
        // "it did not" has nothing to poll for.
        await page.waitForTimeout(2000);
        await expect(modal(page)).toHaveCount(0);

        // It is the first step of the guide, and starts when that is clicked.
        await page.locator('[data-start-guide-open]').click();
        await page.locator('[data-sg-step="tour"] button').click();
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.dashboard-tutorial-progress')).toHaveText(`Step 1 of ${STEPS}`);

        // Leave the store the way an install past its first run has it.
        await page.evaluate(() => window.dashboardInstance.quickStart?.guide?.complete?.());
        // complete() saves without being awaited. Closing the page on a slow
        // runner cancelled that request, the next test found a first run
        // still open and the tour never started (five failures in CI).
        await expect.poll(async () => {
            const response = await page.request.get('/api/settings');
            return (await response.json()).onboardingCompleted;
        }, { timeout: 10_000 }).toBe(true);
    });

    test('an install past its first run gets it on the next load', async ({ page }) => {
        await loadWithTourPending(page);
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
    });

    test('a reader who saw the earlier tour gets this one once', async ({ page }) => {
        await page.addInitScript(() => { window.__e2eSeenTips = ['dashboardTutorialV2']; });
        await loadWithTourPending(page);
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenTip('dashboardTutorialV2'))).toBe(true);
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.dashboard-tutorial-step-title')).toHaveText('The action bar');
    });

    test('the first slide is the action bar: its nine keys, where it stands, and how it comes back', async ({ page }) => {
        await loadWithTourPending(page);
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.dashboard-tutorial-step-title')).toHaveText('The action bar');
        // The nine buttons, each with the key that does the same.
        const keys = await page.locator('.dashboard-tutorial-scene svg .dtv-key-text').allTextContents();
        for (const key of ['+', '>', ':', '?', '/', '*', ',', '.', '!']) expect(keys).toContain(key);
        const body = page.locator('.dashboard-tutorial-step-body');
        await expect(body).toContainText(/action bar/i);
        await expect(body).toContainText(/slides? into the edge/i);
        await expect(body).toContainText(/Config → Appearance → Action bar/);
        // The scene has a drawing of the docked bar, not only a list of keys.
        await expect(page.locator('.dashboard-tutorial-scene svg .dtv-dock')).toHaveCount(1);
    });

    test('Next walks every step, and finishing marks it seen', async ({ page }) => {
        await loadWithTourPending(page);
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
        const titles = [];
        for (let i = 0; i < STEPS; i += 1) {
            titles.push((await page.locator('.dashboard-tutorial-step-title').textContent())?.trim());
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.dashboard-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
            }
        }
        expect(titles).toEqual([
            'The action bar',
            'Pages, categories, bookmarks',
            'With the mouse',
            'Start typing',
            'Two keys to open, Shift to act',
            'Adding: paste, + or the extension',
            'Tags: the cloud and a view per tag',
            'Bookmarks, Inbox and Containers',
            'Make it yours, and find help',
        ]);
        await next(page).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(true);
    });

    test('respects enableSessionTips: false', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.addInitScript((tip) => { window.__e2eWantTours = [tip]; }, TIP);
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            const response = await route.fetch();
            const body = await response.json();
            body.enableSessionTips = false;
            await route.fulfill({ response, json: body });
        });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        // A fixed wait: the tour opens a few seconds after load when it is
        // going to, and "it did not" has nothing to poll for.
        await page.waitForTimeout(3500);
        await expect(modal(page)).toHaveCount(0);
    });

    // A reader who has done the tour does not pay for its script again.
    test('the tour script is not fetched once the tip is seen', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => { if (r.url().includes('dashboard-tutorial.js')) requested.push(r.url()); });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        // A fixed wait: the script is asked for a few seconds after load when
        // the tour is going to open, and "it was not" has nothing to poll for.
        await page.waitForTimeout(3500);
        expect(requested).toEqual([]);
    });

    test('the palette plays it again, seen or not', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.promos.openDashboardTour());
        await expect(modal(page)).toBeVisible();
    });

    test('Shift+K plays it again from the dashboard, seen or not', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 15_000 });
        await page.keyboard.press('Shift+K');
        await expect(modal(page)).toBeVisible();
    });

    test('Shift+K leaves the other views alone', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 15_000 });
        await page.keyboard.press('Shift+H');
        await expect(page.locator('body')).toHaveAttribute('data-active-view', 'library', { timeout: 10_000 });
        await page.keyboard.press('Shift+K');
        // Nothing to poll for when it does not open: give it the time the
        // lazy script takes, then look.
        await page.waitForTimeout(1500);
        await expect(modal(page)).toHaveCount(0);
    });

    test('the scenes animate, and stand still under reduced motion', async ({ page }) => {
        await loadWithTourPending(page);
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
        const running = () => page.evaluate(() =>
            [...document.querySelectorAll('.dashboard-tutorial-scene .dtv-anim')]
                .filter((n) => getComputedStyle(n).animationName !== 'none').length);
        for (let i = 0; i < STEPS; i += 1) {
            expect(await running(), `step ${i + 1} has a moving part`).toBeGreaterThan(0);
            if (i < STEPS - 1) {
                await next(page).click();
                await expect(page.locator('.dashboard-tutorial-progress')).toHaveText(`Step ${i + 2} of ${STEPS}`);
            }
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await running()).toBe(0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => document.body.classList.add('no-animations'));
        expect(await running()).toBe(0);
    });

    /** Labels come from the locale, so a translated dashboard gets a translated tour. */
    test('the scenes carry no hard-coded English labels', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.promos.loadDashboardTour();
            const lang = d.language;
            const orig = lang.t.bind(lang);
            lang.t = (k) => (/^(config\.(section|tour|bmHealth|look|categoryHeader|studio|themeRecolour)|dashboard\.(dashTour|inbox|docker|healthFilter|webSearch|iconSet|widgetType))/.test(k) ? 'XX' : orig(k));
            window.DashboardTutorial.open();
        });
        const words = new Set();
        for (let i = 0; i < STEPS; i += 1) {
            (await page.locator('.dashboard-tutorial-scene text').allTextContents()).forEach((w) => words.add(w.trim()));
            if (i < STEPS - 1) {
                await next(page).click();
                // The dots, not the "Step n" line: that one is among the strings
                // swapped out above.
                await expect(page.locator('.dashboard-tutorial-dot').nth(i + 1)).toHaveClass(/is-active/);
            }
        }
        // Bookmark names, tag names and keys are the reader's data or the
        // keyboard, not labels, so they stay as they are in every language.
        const english = [...words].filter((w) => !w.startsWith(':')).filter((w) =>
            /\b(development|media|home lab|search|commands|finders|edit|move|tags|tick|delete|bookmark|inbox|containers|pages|add|config|recent|back|cheat|weather|unsorted|broken|stale|duplicates|never|promote|keep|triage|tours|guide|saved|default|opens|themes|backdrop|looks|cancel|apply|aurora|dunes|hexagons|glass|frosted|paper|plain|clean|underlined|boxed|neutrals|web|news|video|choose|letter|automatic|recolour|accent|running|shares|asks)\b/i.test(w));
        expect(english).toEqual([]);
    });
});
