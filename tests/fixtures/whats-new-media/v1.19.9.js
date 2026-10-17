// The highlights of v1.19.9: the apps card that app discovery shows, and the
// question an import asks. See tests/whats-new-media.spec.js.

// The shot servers have no Docker socket, so /api/discovery is answered here:
// what a run on a homelab would have found (as tests/manual-screenshots.spec.js).
const found = (name, kind, port, icon, displayName) => ({
    name, kind, url: `http://192.168.1.10:${port}`, icon: icon ? `dashboard-icons/${name}` : '', source: 'port',
    ...(icon ? { iconUrl: `/data/icon-sets/dashboard-icons/${name}.svg` } : {}),
    displayName,
});
const FOUND_APPS = [
    found('plex', 'Media', 32400, true, 'Plex'),
    found('jellyseerr', 'Media management', 5055, true, 'Jellyseerr'),
    found('grafana', 'Monitoring', 3000, false, 'Grafana'),
    found('home-assistant', 'Home', 8123, false, 'Home Assistant'),
];

const BOOKMARK_FILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><A HREF="https://wn-import.example.com/one" ADD_DATE="1610000000" TAGS="Go, weekly">First</A>
    <DT><A HREF="https://wn-import.example.com/two" TOREAD="1">Second</A>
    <DT><A HREF="https://wn-import.example.com/three">Third</A>
  </DL><p>
</DL><p>`;

module.exports = {
    shots: [
        {
            slug: 'apps-found',
            kind: 'image',
            alt: 'The apps found card: Plex, Jellyseerr, Grafana and Home Assistant grouped by kind, all ticked, with an Add button',
            viewport: { width: 1280, height: 900 },
            dataPatch: 'discovery',
            target: (page) => page.locator('.app-discovery-card').first(),
            async setup(page, { openDashboard, settle }) {
                await page.route('**/api/discovery', (route) => (route.request().method() === 'GET'
                    ? route.fulfill({
                        contentType: 'application/json',
                        body: JSON.stringify({
                            enabled: true, docker: true, running: false, cardDone: false, apps: FOUND_APPS,
                        }),
                    })
                    : route.fallback()));
                await openDashboard(page);
                // Corner cards that come a few seconds after load go first: the apps card waits for them.
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(4_000);
                await settle(page);
                await page.locator('.app-discovery-card').first().waitFor({ state: 'visible', timeout: 40_000 });
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(1_000);
            },
        },
        {
            slug: 'import-destination',
            kind: 'image',
            alt: 'The import question: onto the dashboard, or into the inbox first, with what each answer adds and skips',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('#config-confirm-modal .modal').first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.locator('.config-link-anchor').click();
                await page.locator('[data-config-section="data-backups"]').click();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(800);
                await settle(page);
                // Import and export sit inside a collapsed fold.
                await page.evaluate(() => {
                    document.querySelectorAll('details[data-fold]').forEach((d) => { d.open = true; });
                });
                await page.locator('#config-browser-import-input').setInputFiles({
                    name: 'bookmarks.html',
                    mimeType: 'text/html',
                    buffer: Buffer.from(BOOKMARK_FILE),
                });
                await page.locator('#config-confirm-modal [data-import-dest="inbox"]').waitFor({ state: 'visible', timeout: 15_000 });
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(600);
            },
        },
    ],
};
