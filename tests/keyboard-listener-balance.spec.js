// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * An overlay gives its keys back when it closes.
 *
 * The dashboard has no key router, and does not need one: an overlay registers
 * a keydown listener on `document` in the capture phase when it opens, swallows
 * what is its own, and removes the listener when it closes. A census of
 * `Escape` and `Enter` found twenty handlers that can take a key from anyone
 * else, and all twenty work this way.
 *
 * The failure mode that convention has is a leak. A listener that outlives its
 * overlay keeps calling stopImmediatePropagation on `Escape` for the rest of
 * the session, and the key silently stops working everywhere else — the sort of
 * bug that is reported as "Escape sometimes does nothing" and is very hard to
 * find from that description. It is trivial to catch here: count the listeners
 * on `document`, open the overlay, close it, and the count has to come back.
 */

/**
 * Patch add/removeEventListener before any app script runs, and count.
 *
 * `window.__docKeydown` is the original counter and the one the convention is
 * about. `window.__listeners` counts a few more pairs, because the same leak
 * happens to handlers that are not keydown and not on document: a popover's
 * outside-click on document, and a tooltip's window scroll.
 */
async function countDocumentKeydownListeners(page) {
    await page.addInitScript(() => {
        window.__docKeydown = 0;
        window.__listeners = { docMousedown: 0, winScroll: 0, winBlur: 0 };
        const bucket = (target, type) => {
            if (target === document && type === 'mousedown') return 'docMousedown';
            if (target === window && type === 'scroll') return 'winScroll';
            if (target === window && type === 'blur') return 'winBlur';
            return null;
        };
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (type, fn, opts) {
            if (type === 'keydown' && this === document) window.__docKeydown += 1;
            const name = bucket(this, type);
            if (name) window.__listeners[name] += 1;
            return add.call(this, type, fn, opts);
        };
        EventTarget.prototype.removeEventListener = function (type, fn, opts) {
            if (type === 'keydown' && this === document) window.__docKeydown -= 1;
            const name = bucket(this, type);
            if (name) window.__listeners[name] -= 1;
            return remove.call(this, type, fn, opts);
        };
    });
}

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Let the deferred loaders settle, so their listeners are in the baseline
    // rather than arriving mid-measurement.
    await page.waitForTimeout(1500);
}

const listeners = (page) => page.evaluate(() => window.__docKeydown);

test.describe('overlays hand their keys back', () => {
    test.beforeEach(async ({ page }) => {
        await countDocumentKeydownListeners(page);
    });

    test('the bookmark context menu leaves nothing behind', async ({ page }) => {
        await load(page);
        const before = await listeners(page);

        await page.locator('.bookmark-link .bookmark-open').first().click({ button: 'right' });
        await expect(page.locator('#bookmark-context-menu')).toBeVisible({ timeout: 10_000 });
        expect(await listeners(page),
            'the menu opened without taking a listener, so this test is not measuring it')
            .toBeGreaterThan(before);

        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-context-menu')).toBeHidden({ timeout: 10_000 });
        await expect
            .poll(() => listeners(page), { timeout: 5_000 })
            .toBe(before);
    });

    test('opening and closing the same menu repeatedly does not accumulate', async ({ page }) => {
        await load(page);
        const before = await listeners(page);

        // A leak of one per open is invisible once and obvious five times.
        for (let i = 0; i < 5; i += 1) {
            await page.locator('.bookmark-link .bookmark-open').first().click({ button: 'right' });
            await expect(page.locator('#bookmark-context-menu')).toBeVisible({ timeout: 10_000 });
            await page.keyboard.press('Escape');
            await expect(page.locator('#bookmark-context-menu')).toBeHidden({ timeout: 10_000 });
        }

        await expect
            .poll(() => listeners(page), { timeout: 5_000 })
            .toBe(before);
    });

    /*
     * Two presses that overlap must still make one popover.
     *
     * The re-entrancy guard on "Move to..." is checked before the function's
     * one await -- the fetch for the Unsorted page id, taken once per session.
     * Two presses that both start before it resolves both find the guard clear,
     * both append a popover, and both register a capture-phase keydown
     * listener. Only the second is remembered, so one Escape closes one of
     * them, and the one left over swallows Escape and the arrows for the rest
     * of the session. Holding the key down is enough to do it.
     */
    test('two fast Move-to presses leave one popover and no stray listener', async ({ page }) => {
        // Slow enough that the second press certainly lands inside the first
        // press's fetch, which is the window the bug lives in.
        await page.route('**/api/unsorted', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 600));
            await route.continue();
        });

        await load(page);
        const before = await listeners(page);

        // Shift+M acts on the selected row, so select one the way a reader does.
        await page.keyboard.press('ArrowDown');
        await expect
            .poll(() => page.evaluate(
                () => Boolean(window.dashboardInstance?.keyboardNavigation?.getSelectedBookmark?.())),
                { timeout: 10_000 })
            .toBe(true);

        await page.keyboard.press('Shift+M');
        await page.keyboard.press('Shift+M');

        await expect
            .poll(() => page.locator('#move-popover').count(), { timeout: 10_000 })
            .toBe(1);

        await page.keyboard.press('Escape');
        await expect
            .poll(() => page.locator('#move-popover').count(), { timeout: 10_000 })
            .toBe(0);

        await expect
            .poll(() => listeners(page), { timeout: 5_000 })
            .toBe(before);
    });

    /*
     * A rename gives back the handler it bound outside itself.
     *
     * The popover's outside-click handler removed itself only from inside
     * itself, so committing with Enter or cancelling with Escape left it bound
     * -- one more per rename, each testing popover.contains() against a
     * detached node on every click for the rest of the session.
     */
    test('renaming a page tab does not accumulate outside-click handlers', async ({ page }) => {
        await load(page);
        const before = await page.evaluate(() => window.__listeners.docMousedown);

        // A double click on the tab is how a rename starts.
        for (let i = 0; i < 3; i += 1) {
            await page.locator('.page-nav-btn').first().dblclick();
            await expect(page.locator('.page-tab-popover')).toHaveCount(1, { timeout: 10_000 });
            // The outside-click handler is bound a tick after the popover
            // opens, so closing sooner would measure nothing.
            await page.waitForTimeout(120);
            // Escape is bound to the fields, so press it where the reader would.
            await page.locator('.page-tab-popover-name').press('Escape');
            await expect(page.locator('.page-tab-popover')).toHaveCount(0, { timeout: 10_000 });
            await page.waitForTimeout(120);
        }

        await expect
            .poll(() => page.evaluate(() => window.__listeners.docMousedown), { timeout: 5_000 })
            .toBe(before);
    });

    /*
     * And switching shortcut tooltips off takes their window listeners with it.
     *
     * They were bound behind a flag that was set once and never reset, while
     * teardown removed only the three on document -- so a capture-phase window
     * scroll handler went on running for a feature that was no longer there.
     */
    test('turning shortcut tooltips off unbinds what they bound to the window', async ({ page }) => {
        await load(page);

        const counts = () => page.evaluate(() => ({ ...window.__listeners }));

        // The tooltips are a setting, and setup does nothing while it is off.
        const measurable = await page.evaluate(() => {
            const d = window.dashboardInstance;
            if (d.isCoarsePointer?.()) return false;
            d.settings.showShortcutTooltips = true;
            return true;
        });
        test.skip(!measurable, 'no tooltips on a coarse pointer');

        // Start from nothing bound, whatever the page did on load.
        await page.evaluate(() => window.dashboardInstance.toolbar.teardownToolbarKbdTooltips());
        await page.waitForTimeout(150);
        const idle = await counts();

        await page.evaluate(() => window.dashboardInstance.toolbar.setupToolbarKbdTooltips());
        await page.waitForTimeout(150);
        const bound = await counts();
        expect(bound.winScroll,
            'setup bound no window scroll handler, so this test is not measuring it')
            .toBeGreaterThan(idle.winScroll);
        expect(bound.winBlur).toBeGreaterThan(idle.winBlur);

        await page.evaluate(() => window.dashboardInstance.toolbar.teardownToolbarKbdTooltips());
        await expect.poll(counts, { timeout: 5_000 }).toEqual(idle);
    });

    test('search hands its keys back too', async ({ page }) => {
        await load(page);
        const before = await listeners(page);

        await page.keyboard.press('>');
        await expect
            .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
                { timeout: 15_000 })
            .toBe(true);

        await page.keyboard.press('Escape');
        await expect
            .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
                { timeout: 10_000 })
            .toBe(false);

        // Search registers its handlers once, at construction, rather than per
        // open — so the requirement here is that opening it does not add one
        // that outlives the overlay.
        await expect
            .poll(() => listeners(page), { timeout: 5_000 })
            .toBeLessThanOrEqual(before);
    });
});
