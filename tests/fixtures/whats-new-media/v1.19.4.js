// The highlights of v1.19.4: the Jellyfin widget with the posters of a real
// server, and the weekly digest settings. See tests/whats-new-media.spec.js.
//
// The Jellyfin scene needs a data directory that already has a working
// Jellyfin widget on page 1: run with NEXTDASH_DATA_DIR pointing at a COPY of
// the data of an instance that has one. The recording is cropped to the tile,
// so none of the rest of that page is in it.

module.exports = {
    shots: [
        {
            slug: 'jellyfin-widget',
            kind: 'video',
            alt: 'The Jellyfin widget on the dashboard: posters of what was added lately, with the library under each',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('.dashboard-widget-panel.jellyfin-panel').first(),
            async setup(page, { settle }) {
                await page.goto('/#1');
                const tile = page.locator('.dashboard-widget-panel.jellyfin-panel').first();
                await tile.waitFor();
                await page.locator('[data-jellyfin-item] img').first().waitFor();
                await tile.evaluate((el) => el.scrollIntoView({ block: 'center' }));
                await settle(page);
            },
            async act(page) {
                // Rest the pointer on a few posters, left to right.
                const posters = page.locator('[data-jellyfin-item]');
                const n = Math.min(await posters.count(), 4);
                for (let i = 0; i < n; i += 1) {
                    await posters.nth(i).hover();
                    await page.waitForTimeout(700);
                }
            },
        },
        {
            slug: 'weekly-digest',
            kind: 'video',
            alt: 'Config → Monitoring → Notifications, scrolled to the weekly digest',
            viewport: { width: 1280, height: 900 },
            // The digest's own panel, not the whole Config page.
            target: (page) => page.locator('.config-panel', {
                has: page.getByRole('heading', { name: /^Weekly digest/ }),
            }).first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.locator('.config-link-anchor').click();
                await page.locator('[data-config-section="monitoring"]').click();
                await page.waitForTimeout(800);
                await settle(page);
            },
            async act(page) {
                await page.locator('.config-subtab', { hasText: 'Notifications' }).first().click();
                await page.waitForTimeout(700);
                const heading = page.getByRole('heading', { name: /^Weekly digest/ }).first();
                await heading.waitFor();
                await heading.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                await page.waitForTimeout(1_500);
            },
        },
    ],
};
