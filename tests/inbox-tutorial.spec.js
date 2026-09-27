// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time Inbox tutorial — a guided tour shown the first time the Inbox
 * view opens, unless the tip has already been marked seen.
 *
 * Most test files mark it seen via dismissBlockingOverlays() so it never gets
 * in the way of unrelated flows; this file is the one place that deliberately
 * leaves it unseen, to exercise the tour itself.
 */

const STEPS = 6;

async function openInboxWithoutMarkingTutorialSeen(page) {
    // What's new is a different overlay from the tutorial and this file has no
    // quarrel with it -- but it was never marked seen here, so it came up over
    // the dashboard and swallowed the click on the header icon. Every test in
    // this file lost its first attempt to it and was saved by the retry, which
    // is what made the pair look chronically flaky. The tutorial itself is
    // still left unseen below; that is the one this file is about.
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    // discoverabilityState is server-backed, so it survives across tests that
    // share the same web server and data dir — an earlier test in this file
    // finishing the tour leaves the tip seen for every test after it. Force it
    // back to unseen rather than assuming a fresh state.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        if (d?.settings) {
            d.settings.onboardingCompleted = true;
            d.settings.inboxEnabled = true;
            // 'respects enableSessionTips: false' turns tips off, and a settings
            // save anywhere after it carries that to the server; every later
            // test that waits for the tour to open by itself would then wait
            // for nothing.
            d.settings.enableSessionTips = true;
        }
        const state = window.DiscoverabilityState;
        if (state?.exportState) {
            const exported = state.exportState();
            exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'inboxTutorialV3');
            state.init?.(exported);
        }
    });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible({ timeout: 15_000 });
}

const modal = (page) => page.locator('#app-modal.show .inbox-tutorial-modal');

test.describe('inbox tutorial', () => {
    test('shows on first visit to the inbox, with six steps', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);

        await expect(modal(page)).toBeVisible();
        await expect(page.locator('.inbox-tutorial-progress')).toHaveText(`Step 1 of ${STEPS}`);
        await expect(page.locator('.inbox-tutorial-dot')).toHaveCount(STEPS);
        await expect(page.locator('.inbox-tutorial-dot.is-active')).toHaveCount(1);
    });

    test('does not show again once seen', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);
        await expect(modal(page)).toBeVisible();
        await page.locator('.modal-actions .modal-button', { hasText: 'Skip' }).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.inbox.closeInboxView());
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    test('Next walks through every step in order, Back returns', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);

        const titles = [];
        for (let i = 0; i < STEPS; i += 1) {
            titles.push((await page.locator('.inbox-tutorial-step-title').textContent())?.trim());
            if (i < STEPS - 1) {
                await page.locator('.modal-actions .modal-button', { hasText: 'Next' }).click();
                await page.waitForTimeout(120);
            }
        }
        expect(titles).toEqual([
            'A waiting room for links',
            'Read, snoozed, noted',
            'The side panel',
            'Every link leaves one of three ways',
            'Kept links wait in Bookmarks › Unsorted',
            'Triage, and the keys',
        ]);
        await expect(page.locator('.inbox-tutorial-progress')).toHaveText(`Step ${STEPS} of ${STEPS}`);

        // The confirm button reads differently on the last step, and the
        // secondary button becomes Back instead of Skip once stepping forward.
        await expect(page.locator('.modal-actions .modal-button').first()).toHaveText('Got it');
        await expect(page.locator('.modal-actions .modal-button').nth(1)).toHaveText('Back');

        await page.locator('.modal-actions .modal-button', { hasText: 'Back' }).click();
        await page.waitForTimeout(120);
        await expect(page.locator('.inbox-tutorial-progress')).toHaveText(`Step ${STEPS - 1} of ${STEPS}`);
    });

    test('finishing on the last step marks it seen too', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);
        for (let i = 0; i < STEPS - 1; i += 1) {
            await page.locator('.modal-actions .modal-button', { hasText: 'Next' }).click();
            await page.waitForTimeout(100);
        }
        await page.locator('.modal-actions .modal-button', { hasText: 'Got it' }).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        const seen = await page.evaluate(() => window.DiscoverabilityState?.hasSeenTip?.('inboxTutorialV3'));
        expect(seen).toBe(true);
    });

    test('dismissing via Escape still marks it seen, not just an explicit button', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        const seen = await page.evaluate(() => window.DiscoverabilityState?.hasSeenTip?.('inboxTutorialV3'));
        expect(seen).toBe(true);
    });

    test('respects enableSessionTips: false', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        // prepareDashboardInteraction already marked the tip seen — reset it so
        // this test genuinely exercises the enableSessionTips guard rather than
        // passing for the wrong reason.
        await page.evaluate(() => {
            window.dashboardInstance.settings.enableSessionTips = false;
            const state = window.DiscoverabilityState;
            if (state?.exportState) {
                const exported = state.exportState();
                exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'inboxTutorialV3');
                state.init?.(exported);
            }
        });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.waitForTimeout(700);
        await expect(modal(page)).toHaveCount(0);
    });

    // The script is fetched on demand rather than riding along with the inbox
    // module, which bootstraps on every dashboard load for the unread badge.
    // A session that has already done the tour must not pay for it again.
    test('the tour script is not fetched once the tip is seen', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => {
            if (r.url().includes('inbox-tutorial.js')) requested.push(r.url());
        });

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.waitForTimeout(700);

        expect(requested).toEqual([]);
    });

    /** Shown once, it would be gone for good: Tour brings it back, seen or not. */
    test('Tour opens it again, seen or not', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.waitForTimeout(500);
        await expect(modal(page)).toHaveCount(0);

        await page.locator('.inbox-actions-own [data-inbox-tour]').click();
        await expect(modal(page)).toBeVisible();
        // Pictures, not only prose: every step carries a drawn scene.
        await expect(page.locator('.inbox-tutorial-scene svg.itv')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
    });

    /**
     * The scenes move -- links stream in, a row dims as read, the panel slides
     * in, a kept row flies to the Bookmarks icon -- but a reader who asked for
     * less motion gets the same pictures standing still. The still frame is
     * the resting state of every animation, so it still tells the whole story.
     */
    test('the scenes animate, and stand still under reduced motion', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);
        await expect(modal(page)).toBeVisible();

        const running = () => page.evaluate(() =>
            [...document.querySelectorAll('.inbox-tutorial-scene .itv-anim')]
                .filter((n) => getComputedStyle(n).animationName !== 'none').length);

        for (let i = 0; i < STEPS; i += 1) {
            expect(await running(), `step ${i + 1} has a moving part`).toBeGreaterThan(0);
            if (i < STEPS - 1) {
                await page.locator('.modal-actions .modal-button', { hasText: 'Next' }).click();
                await page.waitForTimeout(120);
            }
        }

        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await running()).toBe(0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        // The app's own switch, for a browser that does not say so.
        await page.evaluate(() => document.body.classList.add('no-animations'));
        expect(await running()).toBe(0);
    });

    /** Labels come from the locale, so a translated inbox gets a translated tour. */
    test('the scenes carry no hard-coded English labels', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        await page.evaluate(() => {
            const lang = window.dashboardInstance.language;
            const orig = lang.t.bind(lang);
            lang.t = (k) => (k.startsWith('dashboard.inbox') ? 'XX' : orig(k));
            window.InboxTutorial.open();
        });
        const words = new Set();
        for (let i = 0; i < STEPS; i += 1) {
            (await page.locator('.inbox-tutorial-scene text').allTextContents())
                .forEach((t) => words.add(t.trim()));
            if (i < STEPS - 1) {
                // The confirm button is first; its label is 'XX' now too.
                await page.locator('.modal-actions .modal-button').first().click();
                await page.waitForTimeout(80);
            }
        }
        const english = [...words].filter((w) =>
            /\b(read|keep|promote|snooze|delete|note|move|share|paste|gone|unsorted|bookmarks|tour)\b/i.test(w));
        expect(english).toEqual([]);
    });
});
