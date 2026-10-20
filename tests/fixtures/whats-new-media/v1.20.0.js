// The highlights of v1.20.0: the new default look, Confetti, the Server tab of
// Statistics and the Quick start guide. See tests/whats-new-media.spec.js.

module.exports = {
    shots: [
        {
            slug: 'confetti-looks',
            kind: 'image',
            alt: 'The dashboard in Confetti: categories and widgets on glass over a colour-burst backdrop',
            viewport: { width: 1280, height: 800 },
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                // Pacing for the capture, not a condition: corner cards and the backdrop get time to settle.
                await page.waitForTimeout(3_000);
                await settle(page);
            },
        },
        {
            slug: 'server-stats',
            kind: 'image',
            alt: 'Config, Statistics, Server tab: containers running, unhealthy and updates waiting, the Unraid array, resources now and the Unraid disks',
            viewport: { width: 1280, height: 900 },
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.goto('/#config/stats/server');
                await page.locator('[data-config-section]').first().waitFor();
                await settle(page);
                // The panels fill from several requests; give them the time they need before the frame is taken.
                await page.waitForTimeout(2_500);
            },
        },
        {
            slug: 'quick-start',
            kind: 'image',
            alt: 'The Quick start guide open over the dashboard of a new install: what to do with the example links, the language, the weather and the first of the next steps',
            viewport: { width: 1280, height: 800 },
            dataPatch: 'empty',
            async setup(page) {
                await page.goto('/');
                await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 30_000 });
                await page.locator('[data-start-guide-bar]').waitFor({ state: 'visible', timeout: 30_000 });
                // The look a new install starts on: Confetti, dark.
                await page.evaluate(() => window.dashboardInstance.config.applyThemeChoice('look-confetti-dark'));
                await page.waitForFunction(() => document.body.getAttribute('data-theme') === 'look-confetti-dark', null, { timeout: 10_000 });
                // Pacing for the capture, not a condition: the backdrop draws itself before the guide opens over it.
                await page.waitForTimeout(2_000);
                await page.locator('[data-start-guide-open]').click();
                await page.locator('[data-start-guide-modal]').waitFor({ state: 'visible' });
                // Pacing for the capture, not a condition: the guide finishes drawing before the frame is taken.
                await page.waitForTimeout(1_200);
            },
        },
    ],
};
