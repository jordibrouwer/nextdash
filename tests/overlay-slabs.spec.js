// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Depth inside an overlay comes from edges, never from transparency.
 *
 * An overlay panel is near-opaque because it carries text the reader acts on.
 * What sits inside it still wants separating -- a cheat sheet is a dozen
 * sections, the tag cloud is a field of tags, the recents list is a stack of
 * rows -- but it cannot get that by being more see-through. It gets it the
 * other way: its own surface step, the lit top edge, the shaded bottom edge,
 * and a small lift.
 *
 * The sheet is solid ground; its sections are slabs standing on it.
 */

async function openDashboard(page, depth = 'rich') {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => document.body.setAttribute('data-depth', value), depth);
}

/** Paints a probe with the class so the rule resolves the same way it would live. */
const slabStyle = (page, className) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.className = name;
    document.body.appendChild(probe);
    const style = window.getComputedStyle(probe);
    const value = {
        background: style.backgroundColor,
        shadow: style.boxShadow,
        radius: style.borderTopLeftRadius,
    };
    probe.remove();
    return value;
}, className);

/** Two inset lines in one declaration: one lighting the top, one shading the foot. */
const insetCount = (shadow) => shadow.split(/,(?![^(]*\))/).filter((p) => p.includes('inset')).length;

const SLABS = ['cheat-sheet-group', 'recent-bookmarks-modal-list', 'tag-cloud-modal-body'];

test.describe('overlay slabs', () => {
    for (const className of SLABS) {
        test(`.${className} stands on the sheet rather than in it`, async ({ page }) => {
            await openDashboard(page);
            const style = await slabStyle(page, className);

            expect(insetCount(style.shadow), `no two-sided edge: ${style.shadow}`)
                .toBeGreaterThanOrEqual(2);
            expect(parseFloat(style.radius), 'a slab with square corners').toBeGreaterThan(0);
        });
    }

    test('flat leaves them flat', async ({ page }) => {
        await openDashboard(page, 'flat');

        for (const className of SLABS) {
            const style = await slabStyle(page, className);
            const paints = style.shadow !== 'none'
                && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(style.shadow);
            expect(paints, `.${className} drew an edge on flat`).toBe(false);
        }
    });
});
