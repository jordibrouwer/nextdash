// The highlights of v1.20.0: the new default look, Confetti, and the Server
// tab of Statistics. See tests/whats-new-media.spec.js.

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
    ],
};
