// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Settings in this view save the moment they change, with no Save button, so the
 * save state is the only thing that confirms a change landed. It also has to be
 * readable from the bottom of a long tab — a confirmation you must scroll back
 * up to read confirms nothing.
 */
async function openDisplayTab(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    // showRecentButton sits on the Toolbar tab ("Button bar — extras"), not on
    // Display; the setting moved and this helper kept clicking the old tab.
    await page.locator('[data-appearance-tab="toolbar"]').click();
    await expect(page.locator('[data-behavior-field="showRecentButton"]')).toBeVisible();
}

const state = page => page.locator('#config-save-state');

test.describe('config save feedback', () => {
    test('changing a setting confirms it was saved', async ({ page }) => {
        await openDisplayTab(page);
        await expect(state(page)).toBeHidden();
        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await expect(state(page)).toHaveClass(/is-saved/);
        await expect(state(page)).toContainText(/saved/i);
    });

    test('a failed save says so and does not claim success', async ({ page }) => {
        await openDisplayTab(page);
        await page.route('**/api/settings', (route) => route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'nope' })
            : route.fallback());

        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await expect(state(page)).toHaveClass(/is-error/);
        await expect(state(page)).not.toHaveClass(/is-saved/);
    });

    test('the confirmation clears itself so it cannot go stale', async ({ page }) => {
        await openDisplayTab(page);
        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await expect(state(page)).toHaveClass(/is-saved/);
        // Fades after a couple of seconds; an error would not.
        await expect(state(page)).toBeHidden({ timeout: 6000 });
    });

    test('an error stays put instead of fading', async ({ page }) => {
        await openDisplayTab(page);
        await page.route('**/api/settings', (route) => route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'nope' })
            : route.fallback());
        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await expect(state(page)).toHaveClass(/is-error/);
        await page.waitForTimeout(3200);
        await expect(state(page)).toHaveClass(/is-error/);
    });

    test('it is readable from the bottom of a long tab', async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 640 });
        await openDisplayTab(page);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        // Confirm the premise: the section header really is off-screen here, so
        // an indicator living up there would be unreadable.
        expect(await page.locator('.config-view-section-title')
            .evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(0);

        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await expect(state(page)).toHaveClass(/is-saved/);

        // Fixed to the viewport, so it stays in view wherever the page is
        // scrolled — including after the repaint that follows a save.
        const inView = await state(page).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
        });
        expect(inView).toBe(true);
    });

    test('appearance changes report their save too', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.locator('[data-appearance-font="l"]').click();
        await expect(state(page)).toHaveClass(/is-saved/);
    });


    /**
     * `#dashboard-layout` animates with a transform when a view opens, and a
     * transformed ancestor becomes the containing block for position:fixed —
     * which parked the indicator far below the viewport for the length of that
     * animation. It therefore has to live outside that container.
     */
    test('the indicator is not trapped by the view transform', async ({ page }) => {
        await openDisplayTab(page);
        const parent = await state(page).evaluate((el) => el.parentElement.tagName);
        expect(parent).toBe('BODY');

        // Save immediately after a view switch, while the transform is running.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.locator('[data-appearance-tab="toolbar"]').click();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await page.waitForSelector('#config-save-state.is-saved');

        const r = await state(page).evaluate((el) => {
            const b = el.getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, vh: window.innerHeight };
        });
        expect(r.bottom).toBeLessThanOrEqual(r.vh);
        expect(r.top).toBeGreaterThanOrEqual(0);
    });

    test('leaving config takes the indicator with it', async ({ page }) => {
        await openDisplayTab(page);
        await page.locator('[data-behavior-field="showRecentButton"]').click();
        await expect(state(page)).toHaveClass(/is-saved/);

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect(page.locator('#config-save-state')).toHaveCount(0);
    });

    test('it is announced to assistive tech', async ({ page }) => {
        await openDisplayTab(page);
        await expect(state(page)).toHaveAttribute('role', 'status');
        await expect(state(page)).toHaveAttribute('aria-live', 'polite');
    });
});
