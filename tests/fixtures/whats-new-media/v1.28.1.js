// The highlight of v1.28.1: the Jellystat, Bazarr and Prowlarr tiles. See
// tests/whats-new-media.spec.js. Run it over the seed of
// scripts/make-manual-seed.sh, never over ./data-demo. The tiles are the
// 'arrtiles' patch of the manual-shot kit with mocked answers.
const { mockArrTiles } = require('../../helpers/arr-tile-mocks');

module.exports = {
    shots: [
        {
            slug: 'media-widgets',
            kind: 'image',
            alt: 'Three media tiles on one page: Jellystat with its totals, recent plays, most viewed and most active people, Bazarr with the subtitles that are missing and those fetched lately, and Prowlarr with its indexers and what needs attention',
            // Three tiles two columns wide stand below one another.
            viewport: { width: 1280, height: 2000 },
            dataPatch: 'arrtiles',
            target: (page) => [
                page.locator('[data-widget-type="jellystat"]').first(),
                page.locator('[data-widget-type="bazarr"]').first(),
                page.locator('[data-widget-type="prowlarr"]').first(),
            ],
            async setup(page, kit) {
                await mockArrTiles(page);
                await kit.openDashboard(page, '#4');
                for (const type of ['jellystat', 'bazarr', 'prowlarr']) await page.locator(`[data-widget-type="${type}"]`).first().waitFor();
                // Pacing for the capture, not a condition: the tiles finish drawing.
                await page.waitForTimeout(800);
            },
        },
    ],
};
