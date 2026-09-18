// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A panel opened from a control starts at that control.
 *
 * Fading in at the centre of the window leaves the reader hunting for where
 * the thing came from. ModalOrigin remembers the button that was pressed and
 * the panel grows out of it in 160ms — and only then: a key, a row or a menu
 * has no single point to grow from, so those open the way they always did.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const origin = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
        marked: el.classList.contains('from-origin'),
        x: el.style.getPropertyValue('--modal-origin-x'),
        y: el.style.getPropertyValue('--modal-origin-y'),
    };
}, selector);

test('the search panel grows out of the search button', async ({ page }) => {
    await openDashboard(page);

    await page.locator('#search-button').click();
    await page.waitForSelector('#shortcut-search.show', { timeout: 10_000 });

    const seen = await origin(page, '#shortcut-search .search-container');
    expect(seen.marked, 'the panel opened from nowhere').toBe(true);
    expect(seen.x, 'no horizontal offset was written').toMatch(/-?\d+px/);
    expect(seen.y, 'no vertical offset was written').toMatch(/-?\d+px/);

    // And it is actually playing: a keyframe rather than a transition, because
    // the class and `.show` land in the same tick and a transition has no
    // painted state to start from.
    expect(await page.evaluate(() => document.querySelector('#shortcut-search .search-container')
        .getAnimations().map((a) => a.animationName)), 'nothing is animating')
        .toContain('search-from-origin');
});

test('the same panel opened by key has no origin', async ({ page }) => {
    await openDashboard(page);

    await page.keyboard.press('>');
    await page.waitForSelector('#shortcut-search.show', { timeout: 10_000 });

    const seen = await origin(page, '#shortcut-search .search-container');
    expect(seen.marked, 'a keypress pointed the panel at a button').toBe(false);
});

test('a modal opened from the bar grows out of its button', async ({ page }) => {
    await openDashboard(page);

    /*
     * The cheat sheet, which is an AppModal -- the other half of the origin
     * path. Its button ships off with the launcher header, so it is switched
     * on here: what is under test is the animation, not the default.
     */
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showCheatSheetButton = true;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.setupDOM?.();
    });
    const button = page.locator('#help-button');
    await expect(button).toBeVisible();

    await button.click();
    await page.waitForSelector('#app-modal.show .modal', { timeout: 10_000 });

    const seen = await origin(page, '#app-modal .modal');
    expect(seen.marked, 'the panel opened from nowhere').toBe(true);
    expect(seen.x, 'no horizontal offset was written').toMatch(/-?\d+px/);
    expect(await page.evaluate(() => document.querySelector('#app-modal .modal')
        .getAnimations().map((a) => a.animationName)), 'nothing is animating')
        .toContain('modal-from-origin');
});

test('the mark goes when the panel does', async ({ page }) => {
    await openDashboard(page);

    await page.locator('#search-button').click();
    await page.waitForSelector('#shortcut-search.show', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(false);

    const seen = await origin(page, '#shortcut-search .search-container');
    expect(seen.marked, 'the closed panel still points at a button').toBe(false);
});
