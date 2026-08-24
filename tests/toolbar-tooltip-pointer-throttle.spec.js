// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The toolbar tooltip did a full sweep on every pointermove.
 *
 * syncToolbarKbdTooltip ran unthrottled, re-querying four header selectors per
 * mouse move and resolving :hover on every toolbar button — a style recalc per
 * event for elements that do not move between renders. The buttons were already
 * cached; the header ones were not. It is now one run per frame, with focus
 * changes left unthrottled because those are discrete and must land at once.
 *
 * The teardown is here too: pointermove is bound to the throttled wrapper, so
 * removing the unthrottled function left it running for a feature the user had
 * just switched off — which is exactly what teardownToolbarKbdTooltips' own
 * comment says must not happen.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The hints ship off since 63ef3566, so nothing is bound on a default
    // install and this file has nothing to measure until they are switched on —
    // which is what the setting's own spec does too. The layout is on screen
    // before the instance is assigned, so wait for the object itself first.
    await page.waitForFunction(() => window.dashboardInstance?.toolbar != null,
        null, { timeout: 20_000 });
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showShortcutTooltips = true;
        await d.saveSettings();
        d.setupToolbarKbdTooltips();
    });
    await page.waitForFunction(
        () => typeof window.dashboardInstance?._toolbarKbdTooltipSync === 'function',
        null,
        { timeout: 20_000 },
    );
}

/**
 * Dispatch a burst of pointermove events inside one frame and count the sweeps.
 *
 * Synthetic events rather than page.mouse.move: the real mouse delivers at most
 * one move per frame, so a burst driven that way is already coalesced by the
 * browser and would pass with the throttle deleted. Counting is done at
 * Element.matches(':hover'), which is the per-sweep cost being avoided.
 */
async function countSweeps(page, moves) {
    return page.evaluate(async (count) => {
        let hoverChecks = 0;
        const realMatches = Element.prototype.matches;
        Element.prototype.matches = function countingMatches(selector) {
            if (selector === ':hover') hoverChecks += 1;
            return realMatches.call(this, selector);
        };

        for (let i = 0; i < count; i += 1) {
            document.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true, clientX: 400 + i, clientY: 300 + i,
            }));
        }
        // Let the queued frame run.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));

        Element.prototype.matches = realMatches;
        return hoverChecks;
    }, moves);
}

test.describe('the toolbar tooltip', () => {
    test('the teardown clears both stored references', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.toolbar.teardownToolbarKbdTooltips());
        const refs = await page.evaluate(() => {
            const d = window.dashboardInstance;
            return {
                sync: d._toolbarKbdTooltipSync,
                pointerSync: d._toolbarKbdTooltipPointerSync,
            };
        });
        expect(refs.sync).toBeNull();
        expect(refs.pointerSync).toBeNull();
    });

    test('a burst of pointer moves collapses into one sweep', async ({ page }) => {
        await openDashboard(page);
        // The per-sweep cost, measured on a single sweep.
        const perSweep = await countSweeps(page, 1);
        expect(perSweep).toBeGreaterThan(0);

        // 40 events inside one frame: unthrottled that is 40 sweeps.
        const burst = await countSweeps(page, 40);
        expect(burst).toBeLessThanOrEqual(perSweep * 2);
    });

    test('the teardown actually removes the pointermove listener', async ({ page }) => {
        await openDashboard(page);

        // A regression guard for the throttle rather than for the original
        // defect: teardown was correct while pointermove was bound to the sync
        // itself, and only breaks if the wrapper is introduced without updating
        // the reference the removal uses. Counted the same way the burst test
        // counts, because the sweep is what must stop happening — hooking
        // d._toolbarKbdTooltipSync would measure nothing, since the listener
        // closes over the original function.
        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.toolbar.teardownToolbarKbdTooltips();

            let hoverChecks = 0;
            const realMatches = Element.prototype.matches;
            Element.prototype.matches = function countingMatches(selector) {
                if (selector === ':hover') hoverChecks += 1;
                return realMatches.call(this, selector);
            };
            for (let i = 0; i < 5; i += 1) {
                document.dispatchEvent(new PointerEvent('pointermove', {
                    bubbles: true, clientX: 400 + i, clientY: 300 + i,
                }));
            }
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            Element.prototype.matches = realMatches;

            return { hoverChecks };
        });

        expect(result.hoverChecks).toBe(0);
    });

    test('hovering a toolbar button still shows its tooltip', async ({ page }) => {
        await openDashboard(page);
        // Search is in the tooltip's own defs list; fold-all is not — it gets
        // its key hint from the separate inline-hint path.
        const button = page.locator('#search-button');
        test.skip(await button.count() === 0, 'search button is switched off');

        await button.hover();
        const tip = page.locator('#toolbar-kbd-tooltip');
        await expect(tip).toHaveClass(/is-visible/);
        await expect(tip).not.toBeEmpty();
    });
});
