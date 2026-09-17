// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The tour of a release that moved things: offered once in the corner, eight
 * steps in a window, and the steps where a default moved carry the choice
 * itself. It shows rather than goes -- no step takes the reader somewhere.
 */

const TIP_ID = 'changesTourV1';
const card = (page) => page.locator('.changes-tour-notice-card');
const tour = (page) => page.locator('.changes-tour');
/** The step as the reader sees it: in the overlay, and the overlay shown. */
const shownTour = (page) => page.locator('#app-modal.show .changes-tour');

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

test('Show me walks the steps, forward and back', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.card.render());
    await card(page).locator('[data-changes-tour-action="show"]').click();

    await expect(shownTour(page)).toHaveCount(1);
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
    // Step one: the action bar step has no Show me, because a bar that has
    // slid into its edge is not there to be pointed at.
    await page.locator('[data-tour-lit]').click();

    await expect(page.locator('.changes-tour-lit')).toHaveCount(1);
    await expect(page.locator('body.changes-tour-peeking')).toHaveCount(1);
    // Nothing on the dashboard can be pressed while it is lit: a reader shown
    // the config button used to press it, and the tour ended in config.
    await page.locator('.changes-tour-peek-guard').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('body.changes-tour-peeking')).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).not.toContain('#config');
    await expect(shownTour(page)).toHaveCount(1);
});

test('the look ends on its own as well', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    await page.locator('[data-tour-lit]').click();

    await expect(page.locator('body.changes-tour-peeking')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.changes-tour-peek-guard')).toHaveCount(0);
    await expect(shownTour(page)).toHaveCount(1);
});

test('only the first step points at the real screen', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    await expect(page.locator('[data-tour-lit]')).toHaveCount(1);

    // The action bar has slid into its edge, and config is a screen away:
    // neither is there to be pointed at.
    for (const n of [2, 3]) {
        await page.locator('#modal-actions button').first().click();
        await expect(page.locator('.changes-tour-progress')).toHaveText(new RegExp(`${n}.*8`));
        await expect(page.locator('[data-tour-lit]')).toHaveCount(0);
    }
    // And the config step draws the tiles it is about, with their names.
    await expect(page.locator('.changes-tour-tiles b').first()).toBeVisible();
    await expect(page.locator('.changes-tour-tiles i')).toHaveCount(6);

    // The workbench step draws its three columns, with rows picked in the list.
    await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/4.*8/);
    await expect(page.locator('.changes-tour-bench i')).toHaveCount(3);
    await expect(page.locator('.changes-tour-bench u.is-picked')).toHaveCount(2);
});

test('a key a step names is drawn as a key', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    for (let i = 0; i < 6; i += 1) await page.locator('#modal-actions button').first().click();
    await expect(page.locator('.changes-tour-progress')).toHaveText(/7.*8/);

    await expect(page.locator('.changes-tour-step-body kbd')).toHaveText('Shift + A');

    // And the step draws three theme cards, the lacquered one with its badge.
    await expect(page.locator('.changes-tour-swatches i')).toHaveCount(3);
    // The theme browser's own word for it, in the reader's language -- not a
    // literal, which showed the Dutch badge on an English dashboard.
    await expect(page.locator('.changes-tour-swatches i.is-gloss b')).toHaveText('Gloss');
    // Colour, not grey: the chips take the theme's own accents.
    const chip = await page.locator('.changes-tour-chips u').first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = (chip.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    expect(Math.max(r, g, b) - Math.min(r, g, b), `a grey chip: ${chip}`).toBeGreaterThan(0.02);
});

test('no step walks off to another view', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.ChangesTour.open());
    for (let i = 0; i < 7; i += 1) {
        await expect(page.locator('[data-tour-go]')).toHaveCount(0);
        await page.locator('#modal-actions button').first().click();
    }
    await expect(page.locator('[data-tour-go]')).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).not.toContain('#config');
});

test('it can be opened again from the command palette', async ({ page }) => {
    await loadWithTourPending(page);
    await page.evaluate(() => window.DiscoverabilityState?.markTipSeen?.('changesTourV1', { persist: false }));

    await page.keyboard.press(':');
    await page.keyboard.type('changes');
    await page.keyboard.press('Enter');
    await expect(shownTour(page)).toHaveCount(1, { timeout: 5_000 });
});
