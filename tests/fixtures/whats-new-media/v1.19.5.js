// The highlights of v1.19.5 with a picture: the Sonarr widget and Seerr. The
// download clients are a highlight without one: the server they were shot
// against had nothing downloading. See tests/whats-new-media.spec.js.
//
// Like the Jellyfin scene of v1.19.4, these need a data directory that
// already has working Sonarr and Seerr widgets on page 1: run with
// NEXTDASH_DATA_DIR pointing at a COPY of the data of an instance that has
// them, with discoverabilityState.lastWhatsNewRelease set to this release so
// the What's new window stays shut. Sonarr shows upcoming only and Seerr one
// person, so no queue timer and no other name is in the picture. Each shot is
// cropped to its tile.

const tile = (page, type) => page.locator(`.dashboard-widget[data-widget-type="${type}"]`).first();

async function showTile(page, settle, type) {
    await page.goto('/#1');
    const block = tile(page, type);
    await block.waitFor();
    await block.locator('[data-media-item]').first().waitFor();
    await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page);
}

module.exports = {
    shots: [
        {
            slug: 'sonarr-widget',
            kind: 'image',
            alt: 'The Sonarr widget on the dashboard: the episodes coming up, each under its series poster',
            viewport: { width: 1280, height: 900 },
            target: (page) => tile(page, 'sonarr'),
            async setup(page, { settle }) {
                await showTile(page, settle, 'sonarr');
            },
        },
        {
            slug: 'seerr-widget',
            kind: 'image',
            alt: 'The Seerr widget: requests with their posters, who asked and whether they arrived',
            viewport: { width: 1280, height: 900 },
            target: (page) => tile(page, 'seerr'),
            async setup(page, { settle }) {
                await showTile(page, settle, 'seerr');
            },
        },
    ],
};
