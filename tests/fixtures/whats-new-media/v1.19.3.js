// The highlight of v1.19.3: the weekly digest, set up under Config →
// Monitoring → Notifications. See tests/whats-new-media.spec.js.
module.exports = {
    shots: [
        {
            slug: 'weekly-digest',
            kind: 'video',
            alt: 'The weekly digest settings under Config → Monitoring → Notifications',
            viewport: { width: 1280, height: 900 },
            // The digest's own panel, not the whole Config page.
            target: (page) => page.locator('.config-panel', {
                has: page.getByRole('heading', { name: /^Weekly digest/ }),
            }).first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.locator('.config-link-anchor').click();
                await page.locator('[data-config-section="monitoring"]').click();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(800);
                await settle(page);
            },
            async act(page) {
                await page.locator('.config-subtab', { hasText: 'Notifications' }).first().click();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(700);
                const heading = page.getByRole('heading', { name: /^Weekly digest/ }).first();
                await heading.waitFor();
                await heading.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(1_500);
            },
        },
    ],
};
