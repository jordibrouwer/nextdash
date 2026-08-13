// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The shared "may unprompted UI take the screen right now" gate.
 *
 * The occasional keyboard tip and the what's-new prompt both show something
 * the user never asked for, and both used to carry their own copy of the
 * conditions under which that is allowed — copies that had already drifted:
 * the tip knew not to compete with the quick-start card, the what's-new
 * prompt did not. Both now ask promos.canShowUnpromptedUi().
 *
 * This is deliberately NOT an "initialization finished" signal: it goes false
 * again whenever a modal opens or an inline edit starts, which is why callers
 * still poll it rather than awaiting it once. The deep-link wait (a specific
 * DOM node) and the quick-start baseline wait (bookmark data loaded) answer
 * genuinely different questions and are intentionally left alone.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.promos, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Put the instance into a state where unprompted UI is allowed. */
async function makeScreenFree(page) {
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.onboardingStartedInSession = false;
        d.settings = { ...(d.settings || {}), onboardingCompleted: true };
        document.body.classList.remove('bookmark-inline-edit-active');
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
    });
}

test.describe('canShowUnpromptedUi is the one gate both callers ask', () => {
    test('a free screen allows it, and each blocking condition closes it', async ({ page }) => {
        await openDashboard(page);
        await makeScreenFree(page);

        const results = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const out = {};
            out.free = d.promos.canShowUnpromptedUi();

            document.body.classList.add('bookmark-inline-edit-active');
            out.duringInlineEdit = d.promos.canShowUnpromptedUi();
            document.body.classList.remove('bookmark-inline-edit-active');

            d.onboardingStartedInSession = true;
            out.duringOnboarding = d.promos.canShowUnpromptedUi();
            d.onboardingStartedInSession = false;

            const completed = d.settings.onboardingCompleted;
            d.settings.onboardingCompleted = false;
            out.beforeOnboardingDone = d.promos.canShowUnpromptedUi();
            d.settings.onboardingCompleted = completed;

            const card = document.createElement('div');
            card.className = 'quickstart-card';
            document.body.appendChild(card);
            out.withQuickstart = d.promos.canShowUnpromptedUi();
            // The what's-new prompt keeps its long-standing exemption from this
            // one condition; the tip does not.
            out.withQuickstartExempt = d.promos.canShowUnpromptedUi({ ignoreQuickstart: true });
            out.postOnboardingWithQuickstart = d.promos.canShowPostOnboardingPrompts();
            card.remove();

            return out;
        });

        expect(results.free, 'a free screen should allow unprompted UI').toBe(true);
        expect(results.duringInlineEdit).toBe(false);
        expect(results.duringOnboarding).toBe(false);
        expect(results.beforeOnboardingDone).toBe(false);
        expect(results.withQuickstart, 'a tip must not compete with the quick-start card').toBe(false);
        expect(results.withQuickstartExempt).toBe(true);
        // The regression guard for this refactor: moving the quickstart check
        // into the shared gate must not start blocking what's-new, which was
        // always allowed alongside the card.
        expect(results.postOnboardingWithQuickstart, 'what\'s-new lost its quickstart exemption').toBe(true);
    });

    test('the keyboard tip refuses while the quick-start card is up, and agrees once it goes', async ({ page }) => {
        await openDashboard(page);
        await makeScreenFree(page);

        const results = await page.evaluate(() => {
            const d = window.dashboardInstance;
            // Clear the server-side multi-day gap and the once-per-load guard so
            // shouldShow() is deciding on screen state alone.
            window.DiscoverabilityState?.setTipsNotBefore?.(0);
            d.settings.enableSessionTips = true;

            const card = document.createElement('div');
            card.className = 'quickstart-card';
            document.body.appendChild(card);
            const withCard = window.DashboardKeyboardTip.shouldShow();
            const gateWithCard = d.promos.canShowUnpromptedUi();
            card.remove();

            const withoutCard = window.DashboardKeyboardTip.shouldShow();
            const gateWithoutCard = d.promos.canShowUnpromptedUi();

            return { withCard, gateWithCard, withoutCard, gateWithoutCard };
        });

        // The tip's answer must track the shared gate, not a private copy.
        expect(results.gateWithCard).toBe(false);
        expect(results.withCard, 'the tip ignored the shared gate').toBe(false);
        expect(results.gateWithoutCard).toBe(true);
        expect(results.withoutCard, 'the tip stayed blocked after the gate opened').toBe(true);
    });

    // The check above passes either way, because the tip's fallback branch
    // duplicates the gate's conditions on purpose — same answer, different
    // route. This one proves the route: the tip must actually consult
    // promos.canShowUnpromptedUi rather than reasoning on its own, so that a
    // future condition added to the gate reaches the tip for free. That is the
    // entire point of sharing the primitive.
    test('the tip asks the shared gate rather than re-deriving the answer', async ({ page }) => {
        await openDashboard(page);
        await makeScreenFree(page);

        const observed = await page.evaluate(() => {
            const d = window.dashboardInstance;
            window.DiscoverabilityState?.setTipsNotBefore?.(0);
            d.settings.enableSessionTips = true;

            const original = d.promos.canShowUnpromptedUi.bind(d.promos);
            let calls = 0;
            d.promos.canShowUnpromptedUi = (...args) => {
                calls += 1;
                return original(...args);
            };
            try {
                window.DashboardKeyboardTip.shouldShow();
            } finally {
                d.promos.canShowUnpromptedUi = original;
            }
            return calls;
        });

        expect(observed, 'shouldShow() never consulted the shared gate').toBeGreaterThan(0);
    });
});
