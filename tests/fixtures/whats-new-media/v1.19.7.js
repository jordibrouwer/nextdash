// The highlights of v1.19.7: Appearance in three tab groups, panels that fold
// and say what they are set to, and the five action bar button sizes. See
// tests/whats-new-media.spec.js.
const openAppearance = async (page, { openDashboard, settle }) => {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    await page.locator('[data-config-section="appearance"]').click();
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await settle(page);
};

const tab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();
const foldOf = (page, title) => page
    .locator('#config-appearance-body .config-panel--fold', { has: page.locator('.config-panel-title', { hasText: new RegExp(`^\\s*${title}\\s*$`) }) });

module.exports = {
    shots: [
        {
            slug: 'tab-groups',
            kind: 'image',
            alt: 'Config → Appearance with its nine tabs in three groups: Look, Bookmarks and Header & bars',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('.config-subtabs').first(),
            async setup(page, kit) {
                await openAppearance(page, kit);
            },
        },
        {
            slug: 'folding-panels',
            kind: 'video',
            alt: 'An Appearance panel folding and opening; the folded header says what the panel is set to',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('#config-appearance-body').first(),
            async setup(page, kit) {
                await openAppearance(page, kit);
                await tab(page, 'Background').click();
                await page.locator('#config-appearance-body .config-panel--fold').first().waitFor();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(600);
            },
            async act(page) {
                const heads = page.locator('#config-appearance-body .config-panel--fold > .config-panel-head .config-panel-fold');
                // The first panel is open: fold it, then open the second the way a reader does.
                await heads.nth(0).click();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(900);
                await heads.nth(1).click();
                // Pacing for the capture, not a condition: the opened panel stays on screen long enough to be read.
                await page.waitForTimeout(1_400);
                await heads.nth(1).click();
                // Pacing for the capture, not a condition: the fold finishes before the recording ends.
                await page.waitForTimeout(900);
            },
        },
        {
            slug: 'action-bar-sizes',
            kind: 'video',
            alt: 'The action bar growing as Button size steps from extra small to extra large',
            viewport: { width: 1280, height: 900 },
            async setup(page, kit) {
                await openAppearance(page, kit);
                await tab(page, 'Action bar').click();
                await page.getByRole('combobox', { name: 'Button size' }).waitFor();
                // Pacing for the capture, not a condition: the tab finishes drawing before the recording starts.
                await page.waitForTimeout(600);
            },
            async act(page) {
                const size = page.getByRole('combobox', { name: 'Button size' });
                for (const value of ['xs', 's', 'm', 'l', 'xl', 'm']) {
                    await size.selectOption(value);
                    // Pacing for the capture, not a condition: each size gets a moment on screen.
                    await page.waitForTimeout(900);
                }
            },
        },
    ],
};
