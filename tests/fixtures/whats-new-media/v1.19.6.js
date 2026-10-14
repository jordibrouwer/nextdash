// The highlights of v1.19.6: the tag view, tag suggestions in the rows of the
// Bookmarks view, and the Home Assistant tile. All three run on the demo data;
// Home Assistant has no server there, so its answer is routed, as in
// tests/manual-screenshots.spec.js. See tests/whats-new-media.spec.js.

module.exports = {
    shots: [
        {
            slug: 'tag-view',
            kind: 'image',
            alt: 'The tag view for homelab: every bookmark with the tag from every page, with related tags beside it',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('#dashboard-layout .tag-view'),
            async setup(page, { openDashboard }) {
                await openDashboard(page);
                // Opened the way a reader opens it: the cloud, the tag typed,
                // Enter. Not a click: the pointer would stay over a dashboard
                // row whose preview card then sits over the table.
                await page.keyboard.press('/');
                await page.locator('#tag-cloud-modal.is-open').waitFor();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(600);
                await page.keyboard.type('homelab');
                await page.keyboard.press('Enter');
                const view = page.locator('#dashboard-layout .tag-view');
                await view.locator('.tag-view-row').first().waitFor();
                // Pacing for the capture, not a condition: the morph and the rows settling in.
                await page.waitForTimeout(1_200);
            },
        },
        {
            slug: 'tag-suggestions',
            kind: 'image',
            alt: 'The Bookmarks view with suggested tags after the rows\' own tags, and Add all over the list',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('section', { has: page.locator('#config-bm-offers') }).first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.keyboard.press('Shift+H');
                await page.locator('#config-bm-list .config-bm-row').first().waitFor();
                await page.locator('#config-bm-offers:not([hidden])').waitFor();
                // Pacing for the capture, not a condition: the chips land a moment after the rows.
                await page.waitForTimeout(1_000);
                await settle(page);
            },
        },
        {
            slug: 'home-assistant',
            kind: 'image',
            alt: 'The Home Assistant tile: lights, a scene and sensors in the living room, with switches on the tile',
            dataPatch: 'homeassistant',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('[data-widget-type="homeassistant"]').first(),
            async setup(page, { openDashboard }) {
                const now = Date.now();
                const minute = 60_000;
                const room = { kind: 'entity', library: 'Living room', libraryId: 'Living room', openUrl: 'http://homeassistant.local:8123/history' };
                const items = [
                    { ...room, id: 'light.ceiling', title: 'Ceiling light', addedAt: now - 5 * minute, value: 'on', control: 'toggle', on: true, icon: 'light' },
                    { ...room, id: 'sensor.temperature', title: 'Temperature', addedAt: now - 2 * minute, value: '21.4 °C', icon: 'temperature' },
                    { ...room, id: 'light.reading', title: 'Reading lamp', addedAt: now - 40 * minute, value: 'off', control: 'toggle', on: false, icon: 'light' },
                    { ...room, id: 'scene.movie_night', title: 'Movie night', control: 'run', icon: 'scene' },
                    { ...room, id: 'binary_sensor.back_door', title: 'Back door', library: 'Kitchen', libraryId: 'Kitchen', value: 'off', icon: 'door' },
                ];
                await page.route('**/api/widgets/homeassistant?**', (route) => route.fulfill({ json: {
                    fetchedAt: now, controls: true, libraries: [{ id: 'Kitchen', name: 'Kitchen' }, { id: 'Living room', name: 'Living room' }], items,
                } }));
                await openDashboard(page, '#4');
                await page.locator('[data-widget-type="homeassistant"]').first().waitFor();
                // Pacing for the capture, not a condition: the tile draws a moment after the grid.
                await page.waitForTimeout(800);
            },
        },
    ],
};
