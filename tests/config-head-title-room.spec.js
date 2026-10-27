// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The title of a Config tab must not run into the band's buttons. A material
 * that sets titles in capitals with wide letter-spacing (brushed) is the
 * widest case; the band's fixed controls used to leave the title no room.
 */
for (const [section, width] of [['appearance', 760], ['appearance', 1100], ['bookmarks', 900], ['bookmarks', 1180], ['inbox', 1180]]) {
    test(`the ${section} title clears the buttons at ${width}px in a wide-lettered material`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async (sectionId) => {
            await window.dashboardInstance.config.openConfigView(sectionId);
            document.body.dataset.materialStyle = 'signature';
            document.body.dataset.material = 'brushed';
        }, section);
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
            const title = document.querySelector('.config-view-head .lvs-title');
            const range = document.createRange();
            range.selectNodeContents(title);
            const titleRight = range.getBoundingClientRect().right;
            const actions = document.querySelector('.config-view-head .lvs-header-actions').getBoundingClientRect();
            // The band's children, not the band: they used to spill out of it to the left.
            const first = document.querySelector('.config-view-head .lvs-header-actions .config-changed-bar > *').getBoundingClientRect();
            const head = document.querySelector('.config-view-head').getBoundingClientRect();
            return { titleRight, actionsLeft: Math.min(actions.left, first.left), actionsRight: actions.right, headRight: head.right };
        });
        expect(m.titleRight, 'the title runs into the buttons').toBeLessThanOrEqual(m.actionsLeft);
        expect(m.actionsRight, 'the buttons leave the band').toBeLessThanOrEqual(m.headRight + 1);
    });
}
