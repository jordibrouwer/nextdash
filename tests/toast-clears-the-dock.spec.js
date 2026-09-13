// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A toast must not sit on the buttons.
 *
 * The notification host is fixed to the bottom right, and so is the button bar
 * when that is where the reader put it. A shown toast takes pointer events, so
 * the dock's buttons were unclickable for the twelve seconds an unprompted tip
 * is on screen -- and elementFromPoint over the dock returned the toast.
 *
 * A fixed offset would be a guess: the bar is one row of buttons or two,
 * depending on how many are switched on and how wide the window is. It is
 * measured and published as --button-bar-height instead, the same way
 * list-view-shell.js publishes --lvs-header-height.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.setupDOM != null, null, { timeout: 20_000 });
}

/**
 * Puts the bar somewhere, raises a tip, and reads the two boxes.
 *
 * Waited on rather than slept through: the height is published by a
 * ResizeObserver, and a fixed pause raced it -- the toast was read while it
 * still sat at the offset for the previous position.
 */
const withBarAt = async (page, position) => {
    await page.evaluate((pos) => {
        const d = window.dashboardInstance;
        d.settings.buttonBarPosition = pos;
        d.setupDOM?.();
    }, position);
    await page.waitForFunction((pos) => document.body.getAttribute('data-button-position') === pos
        && window.getComputedStyle(document.body).getPropertyValue('--button-bar-height').trim() !== '',
    position, { timeout: 10_000 });

    await page.evaluate(() => window.DashboardKeyboardTip?.show?.());
    await page.waitForFunction(
        () => document.getElementById('app-notification')?.classList.contains('show') === true,
        null, { timeout: 10_000 });
    // The host animates in from 12px below; its box is only final once that
    // has run out. `show` sets translateY(0), which computes to the identity
    // matrix rather than to `none`.
    await page.waitForFunction(() => {
        const el = document.getElementById('app-notification');
        if (!el) return false;
        const t = window.getComputedStyle(el).transform;
        return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
    }, null, { timeout: 10_000 });

    return page.evaluate(() => {
    const toast = document.getElementById('app-notification');
    const box = toast.getBoundingClientRect();
    const bar = document.querySelector('.button-container')?.getBoundingClientRect();
    const centre = document.elementFromPoint(
        Math.round((box.left + box.right) / 2),
        Math.round((box.top + box.bottom) / 2),
    );
    return {
        shown: toast.classList.contains('show'),
        published: window.getComputedStyle(document.body).getPropertyValue('--button-bar-height').trim(),
        overlapsBar: !!bar && bar.left < box.right && bar.right > box.left
            && bar.top < box.bottom && bar.bottom > box.top,
        // What a click in the middle of the toast would reach. The toast itself
        // is the right answer: it is the thing on top there.
        topmost: centre ? (centre.id || centre.className || centre.tagName).toString() : null,
        inViewport: box.top >= 0 && box.bottom <= window.innerHeight
            && box.left >= 0 && box.right <= window.innerWidth,
    };
    });
};

test.describe('the notification host', () => {
    for (const position of ['bottom-right', 'bottom-centre', 'bottom-left', 'side-right', 'side-left']) {
        test(`clears the button bar at ${position}`, async ({ page }) => {
            await dashboard(page);
            const seen = await withBarAt(page, position);

            expect(seen.shown, 'no tip was raised, so this tested nothing').toBe(true);
            expect(seen.overlapsBar, 'the toast sits on the button bar').toBe(false);
            expect(seen.inViewport, 'the toast was pushed off screen to avoid the bar').toBe(true);
        });
    }

    test('the bar reports its own height, and it is not a guess', async ({ page }) => {
        await dashboard(page);

        const oneRow = await withBarAt(page, 'bottom-centre');
        const rightDock = await withBarAt(page, 'bottom-right');

        expect(parseFloat(oneRow.published), 'nothing published a height').toBeGreaterThan(0);
        // The two positions lay the bar out differently, and the published
        // figure follows -- which is the whole reason it is measured.
        expect(rightDock.published, 'the height did not follow the bar').not.toBe(oneRow.published);
    });
});
