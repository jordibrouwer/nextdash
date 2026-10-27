// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The keyboard tour: offered in the search panel's empty state until it has
 * been seen, and played on request from :tour. Never opened by itself.
 */

const TIP = 'keyboardTutorialV1';
const STEPS = 4;

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    // The fixture keeps this tour seen in every spec unless one asks for it.
    await page.addInitScript((tip) => { window.__e2eWantTours = [tip]; }, TIP);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((tip) => {
        const state = window.DiscoverabilityState;
        window.dashboardInstance.settings.enableSessionTips = true;
        state.forgetTip?.(tip, { persist: false });
        const exported = state.exportState();
        exported.seenTips = (exported.seenTips || []).filter((id) => id !== tip);
        state.init?.(exported);
        window.__tracked = [];
        const original = window.nextdashTrack;
        window.nextdashTrack = (name, props) => {
            window.__tracked.push({ name, props: props || null });
            return original?.(name, props);
        };
    }, TIP);
}

const tour = (page) => page.locator('#app-modal.show .keyboard-tutorial-modal');
const progress = (page) => page.locator('#app-modal.show .keyboard-tutorial-progress');
const confirmButton = (page) => page.locator('#app-modal.show .modal-actions .modal-button').first();
const seen = (page) => page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP);

test.describe('the keyboard tour', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(async (tip) => {
            window.DiscoverabilityState?.forgetTip?.(tip);
            await window.DiscoverabilityState?.persistNow?.();
        }, TIP).catch(() => { /* the page may already be closed */ });
    });

    test('does not open by itself', async ({ page }) => {
        await openDashboard(page);
        // A fixed wait: the tour must stay away, so there is nothing to wait for.
        await page.waitForTimeout(900);
        await expect(tour(page)).toHaveCount(0);
    });

    test(':tour keyboard plays all four steps, each with a picture, and marks it seen', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        await page.keyboard.type('tour keyboard');
        await expect(page.locator('.search-match').first()).toContainText('keyboard');
        await page.keyboard.press('Enter');

        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        for (let step = 1; step <= STEPS; step += 1) {
            await expect(progress(page)).toHaveText(`Step ${step} of ${STEPS}`);
            await expect(page.locator('#app-modal.show .keyboard-tutorial-scene svg')).toHaveCount(1);
            expect((await page.locator('#app-modal.show .keyboard-tutorial-step-body').textContent() || '').trim().length)
                .toBeGreaterThan(60);
            await confirmButton(page).click();
        }
        await expect(page.locator('#app-modal.show')).toHaveCount(0, { timeout: 10_000 });
        expect(await seen(page)).toBe(true);
        const tracked = await page.evaluate(() => window.__tracked.filter((e) => e.name.startsWith('keyboard-tour:')));
        expect(tracked).toEqual([
            { name: 'keyboard-tour:opened', props: { via: 'command' } },
            { name: 'keyboard-tour:finished', props: { outcome: 'completed', step: STEPS } },
        ]);
    });

    test('the search panel offers it until it has been seen', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        const header = page.locator('.search-command-group-header', { hasText: 'Keyboard' });
        await expect(header).toBeVisible();
        await header.click();
        const row = page.locator('.search-match', { hasText: 'Take the keyboard tour' });
        await expect(row).toBeVisible();
        await row.click();
        await expect(tour(page)).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await seen(page)).toBe(true);

        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        // A fixed wait: the row must not come back, so there is nothing to wait for.
        await page.waitForTimeout(500);
        await expect(page.locator('.search-match', { hasText: 'Take the keyboard tour' })).toHaveCount(0);
        const opened = await page.evaluate(() => window.__tracked.filter((e) => e.name === 'keyboard-tour:opened'));
        expect(opened).toEqual([{ name: 'keyboard-tour:opened', props: { via: 'search' } }]);
    });

    test('says nothing when session tips are off', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.enableSessionTips = false; });
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        await page.waitForTimeout(500);
        await expect(page.locator('.search-command-group-header', { hasText: 'Keyboard' })).toHaveCount(0);
    });

    test('commands report how they were opened: key, then button', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        const button = page.locator('#commands-button');
        if (await button.isVisible()) {
            await button.click();
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
        }
        const opens = await page.evaluate(() => window.__tracked.filter((e) => e.name === 'modal:commands').map((e) => e.props));
        expect(opens[0]).toEqual({ via: 'key' });
        if (opens.length > 1) expect(opens[1]).toEqual({ via: 'button' });
    });
});
