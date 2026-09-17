// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The tour of a release that moved things: offered once in the corner, eight
 * steps in a window, and the steps where a default moved carry the choice
 * itself.
 */

const TIP_ID = 'changesTourV1';
const card = (page) => page.locator('.changes-tour-notice-card');
const tour = (page) => page.locator('.changes-tour');

async function loadWithTourPending(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => {
        window.DiscoverabilityState?.forgetTip?.(id, { persist: false });
        window.localStorage.removeItem('nextdash.changesTour.later');
        document.querySelectorAll('.quickstart-card:not(.changes-tour-notice-card)').forEach((el) => el.remove());
    }, TIP_ID);
}

test('the card offers it once, and No thanks answers it for good', async ({ page }) => {
    await loadWithTourPending(page);
    expect(await page.evaluate(() => window.ChangesTour.card.shouldShow())).toBe(true);

    await page.evaluate(() => window.ChangesTour.card.render());
    await expect(card(page)).toBeVisible();
    // Copy, not locale keys.
    await expect(card(page)).not.toContainText('dashboard.changesTour');

    await card(page).locator('button[data-changes-tour-action="no"]:not([data-notice-dismiss])').click();
    await expect(card(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.ChangesTour.card.shouldShow())).toBe(false);
});

test('Later keeps the answer open, and asks again tomorrow', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.card.render());
    await card(page).locator('[data-changes-tour-action="later"]').click();

    await expect(card(page)).toHaveCount(0);
    // Not answered: the tip is untouched, only a postponement was written.
    expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenTip('changesTourV1'))).toBe(false);
    expect(await page.evaluate(() => window.ChangesTour.card.shouldShow())).toBe(false);

    await page.evaluate(() => window.localStorage.setItem('nextdash.changesTour.later', String(Date.now() - 1000)));
    expect(await page.evaluate(() => window.ChangesTour.card.shouldShow())).toBe(true);
});

test('Show me walks the steps and ends on What\'s new', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.card.render());
    await card(page).locator('[data-changes-tour-action="show"]').click();

    await expect(tour(page)).toBeVisible();
    await expect(page.locator('.changes-tour-dot')).toHaveCount(8);
    await expect(page.locator('.changes-tour-progress')).toHaveText(/1.*8/);

    // Forward to the last step, then back one: the window keeps its place.
    for (let i = 0; i < 7; i += 1) await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/8.*8/);
    await page.locator('#modal-actions button').nth(1).click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/7.*8/);
});

test('a step where a default moved puts the old arrangement back', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.actionBarPosition = 'right';
        window.ChangesTour.open();
    });
    // Step two is the action bar.
    await page.locator('#modal-actions button').first().click();
    await expect(page.locator('[data-tour-field="actionBarPosition"]').first()).toBeVisible();

    await page.locator('[data-tour-field="actionBarPosition"][data-tour-value="bottom"]').click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.actionBar)).toBe('bottom');

    const saved = await page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).actionBarPosition;
    });
    expect(saved).toBe('bottom');
});

test('Show me lights up the real thing, and the window comes back', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    await page.locator('[data-tour-lit]').click();

    await expect(page.locator('.changes-tour-lit')).toHaveCount(1);
    await expect(page.locator('body.changes-tour-peeking')).toHaveCount(1);
    // And it hands the window back on its own.
    await expect(page.locator('body.changes-tour-peeking')).toHaveCount(0, { timeout: 5_000 });
    await expect(tour(page)).toBeVisible();
});

test('the config step opens config', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    // Two Nexts: pages, action buttons, then config.
    await page.locator('#modal-actions button').first().click();
    await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/3.*8/);

    await page.locator('[data-tour-go]').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#config');
    // And the step comes back over it: going somewhere is not leaving the tour.
    await expect(tour(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.changes-tour-progress')).toHaveText(/3.*8/);
});

test('a view with a window of its own does not end the tour', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => {
        // Config → Widgets opens a tour of its own on arrival, which closes
        // whatever modal is up as it renders.
        window.DiscoverabilityState?.forgetTip?.('widgetsTutorialV1', { persist: false });
        window.ChangesTour.open();
    });
    for (let i = 0; i < 4; i += 1) await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/5.*8/);

    await page.locator('[data-tour-go]').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('widgets');
    await expect(tour(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.changes-tour-progress')).toHaveText(/5.*8/);
});

test('the looks step opens the theme browser', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    for (let i = 0; i < 6; i += 1) await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/7.*8/);

    await page.locator('[data-tour-go]').click();
    // A window of its own, so this one does end the tour.
    await expect(page.locator('.theme-browser')).toBeVisible({ timeout: 10_000 });
    await expect(tour(page)).toHaveCount(0);
});

test("the last step opens What's new in the same window", async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    for (let i = 0; i < 7; i += 1) await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/8.*8/);

    await page.locator('[data-tour-go]').click();
    await expect(page.locator('.whats-new-modal')).toBeVisible({ timeout: 10_000 });
    await expect(tour(page)).toHaveCount(0);
    // And nothing of the tour is left behind over the dashboard.
    await expect(page.locator('body.changes-tour-peeking')).toHaveCount(0);
});

test('it can be opened again from the command palette', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.DiscoverabilityState?.markTipSeen?.('changesTourV1', { persist: false }));

    await page.keyboard.press(':');
    await page.keyboard.type('changes');
    await page.keyboard.press('Enter');
    await expect(tour(page)).toBeVisible({ timeout: 5_000 });
});
