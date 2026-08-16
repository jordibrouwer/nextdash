// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * One corner, several cards, and every card gets its turn.
 *
 * The cards used to poll for a free corner twenty times at two-second intervals
 * and then give up for the rest of the page load. That works while the corner
 * clears inside forty seconds and fails exactly when it matters: the side rail's
 * invitation stands until it is answered, so on an install carrying an
 * unanswered card, everything queued behind it was never offered at all — and on
 * an upgrade, the what's-new modal holds the corner for as long as someone reads
 * it. Two cards sharing a delay, one script tag apart, settled it by load order.
 *
 * The queue is what these tests are about: a card that loses the moment must
 * come back when the corner frees, however long that takes.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        // The real cards are pending on a test install and would take the corner
        // mid-test — which is the queue doing its job, and no way to tell apart
        // from the queue skipping a probe. Answered here so the corner belongs
        // to the probes alone. Analytics keeps its answer in its own field
        // rather than in the promo list.
        ['side-rail-try-v1', 'category-spread-v1']
            .forEach((id) => window.DiscoverabilityState?.markSettingPromoSeen?.(id, { persist: false }));
        const d = window.dashboardInstance;
        d.settings.quickStart = { ...(d.settings.quickStart || {}), analyticsChoiceMade: true };
    });
}

/** A card that answers to the same NoticeCard machinery, without any gating. */
async function defineProbeCards(page) {
    await page.evaluate(() => {
        window.__shown = [];
        const make = (id, delay) => window.NoticeCard.define({
            id,
            showDelayMs: delay,
            title: () => `probe ${id}`,
            body: () => 'probe',
            canShow: () => true,
            actions: [{ name: 'ok', label: () => 'ok', onClick: (card) => card.close() }],
        });
        window.__first = make('probe-first', 50);
        window.__second = make('probe-second', 50);
        window.__first.autoStart();
        window.__second.autoStart();
    });
}

test.describe('the notice-card queue', () => {
    test('the second card waits, then takes the corner when the first is answered', async ({ page }) => {
        await loadDashboard(page);
        await defineProbeCards(page);

        // One at a time: the corner holds a single card, so the second must not
        // simply render alongside.
        await expect(page.locator('.probe-first-card')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.probe-second-card')).toHaveCount(0);

        // Answering the first is what frees the corner.
        await page.locator('.probe-first-card [data-notice-action="ok"]').click();
        await expect(page.locator('.probe-second-card')).toBeVisible({ timeout: 10_000 });
    });

    // The discriminating one, and the slow one: the old code polled twenty
    // times at two-second intervals, so anything under forty seconds passes
    // either way. Waiting past that budget is the only way to tell "waiting on
    // the corner" apart from "still counting down" — which is the whole bug, so
    // the wait is the test.
    test('a card queued behind an unanswered one still arrives, however long it takes',
        async ({ page }) => {
            test.setTimeout(150_000);
            await loadDashboard(page);
            await defineProbeCards(page);
            await expect(page.locator('.probe-first-card')).toBeVisible({ timeout: 10_000 });

            await page.waitForTimeout(50_000);
            await expect(page.locator('.probe-second-card')).toHaveCount(0);

            await page.locator('.probe-first-card [data-notice-action="ok"]').click();
            await expect(page.locator('.probe-second-card')).toBeVisible({ timeout: 20_000 });
        });

    test('the what\'s-new modal holds the corner, and hands it back on close', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.NoticeCard.define({
                id: 'probe-modal',
                showDelayMs: 50,
                title: () => 'probe',
                body: () => 'probe',
                canShow: () => true,
                actions: [{ name: 'ok', label: () => 'ok', onClick: (card) => card.close() }],
            }).autoStart();
        });
        // Opened straight away, so it is up before the card's own delay elapses.
        await page.evaluate(() => window.dashboardInstance.config.openWhatsNew());
        await expect(page.locator('.whats-new-modal')).toBeVisible({ timeout: 15_000 });

        // The modal is not a notice card and closes without telling anyone,
        // which is why the queue watches the document rather than trusting each
        // owner of the corner to announce itself.
        await page.waitForTimeout(2000);
        await expect(page.locator('.probe-modal-card')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(page.locator('.whats-new-modal')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('.probe-modal-card')).toBeVisible({ timeout: 10_000 });
    });
});
