// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What's New wears the same panel chrome as the other overlays.
 *
 * It named itself and then said "close" three times: a full-width button, an
 * ESC hint under it, and nothing at all in the header. The header carries the
 * name and the way out now, and the Esc hint joins the update line and the
 * Ko-fi link in the foot that was already there.
 */
/*
 * The first panel opened in a cold worker pays for the lazy module and the
 * release fetch behind it, which is more than the default 30s allows for.
 */
test.describe.configure({ timeout: 60_000 });

async function openWhatsNew(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    // Marked seen first, or the panel opens by itself and the button shuts it.
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    /*
     * The Quick setup card lands over that corner a beat after the dashboard
     * does, so one sweep before it appears is not enough -- it is what
     * intercepts the click when it is not cleared again here.
     */
    await dismissBlockingOverlays(page);
    await dismissOnboardingIfPresent(page);
    // Through the button someone clicks, not through the lazy module.
    const button = page.locator('#whats-new-btn');
    await button.waitFor({ state: 'visible', timeout: 20_000 });

    /*
     * The button toggles, and the Quick setup card can still land over that
     * corner between a sweep and a click. Poll on the panel being up and click
     * only while it is not, rather than clicking once and hoping.
     *
     * The panel, not its contents: the entries come from a release feed that
     * can be unreachable, and what is under test is the panel's own chrome.
     */
    await expect.poll(async () => {
        if (await page.locator('#app-modal.show .whats-new-modal').count() > 0) return true;
        await dismissOnboardingIfPresent(page);
        await button.click({ timeout: 5_000 }).catch(() => {});
        return await page.locator('#app-modal.show .whats-new-modal').count() > 0;
    }, { timeout: 40_000 }).toBe(true);
}

test('the section headings are named the way the app names things', async ({ page }) => {
    await openWhatsNew(page);

    // Off a probe, so an unreachable release feed cannot decide the answer.
    const transform = await page.evaluate(() => {
        const probe = document.createElement('h4');
        probe.className = 'wn-group-title';
        document.querySelector('.whats-new-modal').appendChild(probe);
        const value = window.getComputedStyle(probe).textTransform;
        probe.remove();
        return value;
    });
    expect(transform, 'the section headings shout again').toBe('lowercase');
});

/**
 * One #app-modal serves every panel, so the header has to be cleared for the
 * next one.
 *
 * The cheat sheet hangs its "!" chip and its close button beside the title.
 * show() only ever replaced the title, so opening What's New afterwards left
 * both of them in place: two "Esc x" buttons, and a key chip naming a panel
 * the reader was no longer looking at.
 */
test('a panel does not inherit the previous one\'s header', async ({ page }) => {
    await openWhatsNew(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal.show')).toHaveCount(0);

    await page.keyboard.press('Shift+Digit1');
    await page.waitForSelector('#app-modal.show .keyboard-cheat-sheet-modal', { timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal.show')).toHaveCount(0);

    /*
     * The Quick setup card can still arrive between the sweep and the click,
     * so wait for the corner to actually be clear rather than sweeping once
     * more and hoping.
     */
    await expect.poll(async () => {
        await dismissOnboardingIfPresent(page);
        return page.locator('.quickstart-card.show').count();
    }, { timeout: 20_000 }).toBe(0);

    await page.locator('#whats-new-btn').click();
    await page.waitForSelector('#app-modal.show .whats-new-modal', { timeout: 20_000 });

    const header = page.locator('#app-modal .modal-header');
    expect(await header.locator('[data-modal-header-extra]').count(),
        'the header kept the last panel\'s furniture').toBe(1);
    expect(await header.locator('.cheat-sheet-modal-key').count(),
        'the cheat sheet\'s key chip is still there').toBe(0);

    // The header is the way out now, so the wide Close button under the list
    // and the ESC hint under that are gone.
    const actions = await page.evaluate(() => {
        const el = document.querySelector('.whats-new-modal .modal-actions');
        return el ? window.getComputedStyle(el).display : 'absent';
    });
    expect(actions, 'the wide Close button is back').toBe('none');
    await expect(page.locator('.wn-modal-close')).toBeVisible();
});
