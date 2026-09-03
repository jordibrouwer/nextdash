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

const STEPS = 7;

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
        }
        const state = window.DiscoverabilityState;
        if (state?.exportState) {
            const exported = state.exportState();
            exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'inboxTutorialV1');
            state.init?.(exported);
        }
    });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible({ timeout: 15_000 });
}

const modal = (page) => page.locator('#app-modal.show .inbox-tutorial-modal');

test.describe('inbox tutorial', () => {
    test('shows on first visit to the inbox, with seven steps', async ({ page }) => {
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
            'A place for links you have not decided about yet',
            'Read is not the same as dealt with',
            'Snooze the ones that are not for today',
            'Write down why you saved it',
            'Promote turns a link into a real bookmark',
            'Triage: the whole backlog, no mouse',
            'Selecting, narrowing, and sharing the view',
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

        const seen = await page.evaluate(() => window.DiscoverabilityState?.hasSeenTip?.('inboxTutorialV1'));
        expect(seen).toBe(true);
    });

    test('dismissing via Escape still marks it seen, not just an explicit button', async ({ page }) => {
        await openInboxWithoutMarkingTutorialSeen(page);
        await expect(modal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        const seen = await page.evaluate(() => window.DiscoverabilityState?.hasSeenTip?.('inboxTutorialV1'));
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
                exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'inboxTutorialV1');
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
});
