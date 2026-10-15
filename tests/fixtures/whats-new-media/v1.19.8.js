// The highlights of v1.19.8: the Emby and now playing tiles, the tag view of
// every bookmark (Shift+T), Find tags in the inbox, and self-hosted apps known
// by name. All four run on the demo data. The media servers have none there,
// so their answers are routed, as in v1.19.6.js. See tests/whats-new-media.spec.js.

/** A poster drawn in place of the picture a media server would send. */
function poster(title, hue) {
    const letters = String(title).split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},45%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,18%)"/></linearGradient></defs>
<rect width="200" height="300" fill="url(#g)"/>
<text x="100" y="170" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${letters}</text></svg>`;
}

async function routeMedia(page) {
    const now = Date.now();
    const minute = 60_000;
    const hour = 60 * minute;
    const pic = (name) => `/api/widgets/media-demo/image?t=${encodeURIComponent(name)}`;
    await page.route('**/api/widgets/media-demo/image**', (route) => {
        const name = new URL(route.request().url()).searchParams.get('t') || '?';
        const hue = [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360;
        return route.fulfill({ contentType: 'image/svg+xml', body: poster(name, hue) });
    });
    await page.route('**/api/widgets/emby?**', (route) => route.fulfill({ json: {
        fetchedAt: now,
        libraries: [{ id: 'films', name: 'Films' }, { id: 'series', name: 'Series' }],
        items: [
            { kind: 'movie', title: 'The Long Harbour', library: 'Films', year: 2024, addedAt: now - 25 * minute, poster: pic('The Long Harbour') },
            { kind: 'episode', title: 'Night Shift', subtitle: 'S02E05', library: 'Series', addedAt: now - 3 * hour, poster: pic('Night Shift') },
            { kind: 'movie', title: 'Paper Lanterns', library: 'Films', year: 2023, addedAt: now - 7 * hour, poster: pic('Paper Lanterns') },
            { kind: 'episode', title: 'Signal Lost', subtitle: 'S01E08', library: 'Series', addedAt: now - 26 * hour, poster: pic('Signal Lost') },
        ],
    } }));
    await page.route('**/api/widgets/jellyfin-playing?**', (route) => route.fulfill({ json: {
        fetchedAt: now,
        items: [
            { kind: 'movie', title: 'The Long Harbour', who: 'Mira', device: 'Living room TV', method: 'direct', remaining: 41 * 60, progress: 0.62, poster: pic('The Long Harbour') },
            { kind: 'episode', title: 'Night Shift', subtitle: 'S02E05', who: 'Joep', device: 'iPad', method: 'transcode', remaining: 12 * 60, progress: 0.71, poster: pic('Night Shift') },
        ],
    } }));
    await page.route('**/api/widgets/plex-playing?**', (route) => route.fulfill({ json: {
        fetchedAt: now,
        items: [
            { kind: 'episode', title: 'Signal Lost', subtitle: 'S01E08', who: 'Sanne', device: 'Chromecast', method: 'direct', remaining: 27 * 60, progress: 0.34, poster: pic('Signal Lost') },
        ],
    } }));
}

module.exports = {
    shots: [
        {
            slug: 'now-playing',
            kind: 'image',
            alt: 'A page with an Emby tile of what was added lately, and now playing tiles for Jellyfin and Plex showing who is watching what',
            dataPatch: 'media',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('#dashboard-layout'),
            async setup(page, { openDashboard }) {
                await routeMedia(page);
                await openDashboard(page, '#4');
                // The Today and Fresh categories are not what this picture is about.
                await page.addStyleTag({ content: '.category:not(.dashboard-widget):not(:has(.dashboard-widget)) { display: none !important; }' });
                await page.locator('.dashboard-widget[data-widget-type="plex-playing"] [data-media-item]').first().waitFor();
                await page.locator('.dashboard-widget[data-widget-type="emby"] [data-media-item]').first().waitFor();
                // Pacing for the capture, not a condition: the posters arrive a moment after the rows.
                await page.waitForTimeout(1_000);
            },
        },
        {
            slug: 'tag-view-all',
            kind: 'video',
            dataPatch: 'untagged',
            alt: 'Shift+T with nothing selected opens the tag view of every bookmark; the Without tags filter then narrows the list',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('#dashboard-layout .tag-view'),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
            },
            async act(page) {
                await page.keyboard.press('Shift+T');
                const view = page.locator('#dashboard-layout .tag-view');
                await view.locator('.tag-view-row').first().waitFor();
                // Pacing for the capture, not a condition: the morph and the rows settling in.
                await page.waitForTimeout(1_500);
                await view.locator('[data-rail-untagged]').first().click();
                // Pacing for the capture, not a condition: the list narrows in its own time.
                await page.waitForTimeout(1_500);
            },
        },
        {
            slug: 'inbox-find-tags',
            kind: 'image',
            alt: 'The inbox after Find tags: dashed chips with the tag on offer on each link, and a count over the list',
            dataPatch: 'inbox-tags',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('.inbox-layout'),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.locator('#page-nav-inbox-btn').click();
                await page.locator('.inbox-layout').waitFor();
                await page.locator('[data-inbox-toolbar-more]').click();
                await page.locator('[data-inbox-find-tags]').click();
                // Pacing for the capture, not a condition: the round runs and the chips land after it.
                await page.waitForTimeout(3_000);
                await settle(page);
            },
        },
        {
            slug: 'self-hosted-by-name',
            kind: 'image',
            alt: 'The tags field of the bookmark form for sonarr.home.lan, with homelab and media-server suggested from the name alone',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('.bookmark-inline-field', { has: page.locator('.tag-suggest-chips') }),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.keyboard.press('+');
                await page.getByRole('dialog', { name: 'Create New Bookmark' }).waitFor();
                // The form opens with the cursor in URL.
                await page.waitForTimeout(400);
                await page.keyboard.type('http://sonarr.home.lan:8989', { delay: 10 });
                await page.keyboard.press('Tab');
                await page.locator('.tag-suggest-chips').waitFor({ state: 'visible' });
                // Pacing for the capture, not a condition: the chips settle after they appear.
                await page.waitForTimeout(800);
                await settle(page);
            },
        },
    ],
};
