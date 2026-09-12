// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What's New reads like the rest of the app.
 *
 * There is no draft of this modal -- the redesign covered the dashboard, the
 * three list views, the command panel and the three dashboard overlays -- so
 * what applies to it is the language those drafts agreed on and that the app
 * now carries: an overlay sits on solid ground, and what stands inside it is
 * a slab with a lit top edge and a shaded foot.
 *
 * Its two lists get the same treatment the recents list did: one slab holding
 * the rows, not a slab per row. The hairlines between entries stay; they are
 * what separates one release from the next inside a single block.
 */

async function openWhatsNew(page, depth = 'rich') {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => document.body.setAttribute('data-depth', value), depth);
}

/** Styles a probe with the class so the rule resolves as it would live. */
const shadowOf = (page, className) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.className = name;
    document.body.appendChild(probe);
    const value = window.getComputedStyle(probe).boxShadow;
    probe.remove();
    return value;
}, className);

const insetCount = (shadow) => shadow.split(/,(?![^(]*\))/).filter((p) => p.includes('inset')).length;

test.describe("what's new slabs", () => {
    for (const className of ['wn-entries', 'wn-earlier']) {
        test(`.${className} stands on the sheet`, async ({ page }) => {
            await openWhatsNew(page);
            const shadow = await shadowOf(page, className);

            expect(insetCount(shadow), `no two-sided edge: ${shadow}`).toBeGreaterThanOrEqual(2);
        });
    }

    test('flat leaves it flat', async ({ page }) => {
        await openWhatsNew(page, 'flat');

        for (const className of ['wn-entries', 'wn-earlier']) {
            const shadow = await shadowOf(page, className);
            const paints = shadow !== 'none' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(shadow);
            expect(paints, `.${className} drew an edge on flat`).toBe(false);
        }
    });
});
