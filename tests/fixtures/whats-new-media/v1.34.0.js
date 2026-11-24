// The highlights of v1.34.0: Quick launch (a recording) and the timeline in its
// new look (a picture). See tests/whats-new-media.spec.js.
// /api/timeline is answered by the plan with one invented story, so the
// picture reads the same on every machine.
const SONARR_URL = 'http://sonarr.lan:8989/';

function timelineAnswer(now) {
    const at = (min) => now - min * 60_000;
    const update = { id: 'u1', at: at(75), source: 'update', kind: 'update', by: 'auto', from: '4.0.9', to: '4.0.10', subject: { type: 'container', name: 'sonarr' }, link: '#service?container=sonarr', causeOf: ['d1'] };
    const down = {
        id: 'd1', at: at(74), end: at(60), durationMs: 14 * 60_000, source: 'health', kind: 'down', outage: true, count: 1,
        subject: { type: 'bookmark', name: 'Sonarr', key: 'sonarr.lan' }, link: `#service?url=${encodeURIComponent(SONARR_URL)}&page=1`,
        detail: 'HTTP 502', causes: [{ eventId: 'u1', gapMs: 60_000, relation: 'linked-bookmark', confidence: 'sure' }],
    };
    const cpu = { id: 'g1', at: at(26 * 60), end: at(26 * 60 - 10), durationMs: 10 * 60_000, source: 'glances', kind: 'cpu', outage: true, subject: { type: 'glances', name: 'Tower', key: 'main' }, link: '#glances', detail: 'peak 94' };
    const flap = { id: 'd2', at: at(30 * 60), end: at(30 * 60 - 3), durationMs: 3 * 60_000, source: 'health', kind: 'down', outage: true, count: 1, subject: { type: 'bookmark', name: 'Jellyfin', key: 'jellyfin.lan' }, link: '#service?container=jellyfin', detail: 'timeout' };
    return {
        generatedAt: now, from: now - 7 * 86_400_000, to: now, events: [down, update, cpu, flap], related: [],
        coverage: { docker: { ok: true }, update: { ok: true }, health: { ok: true }, check: { ok: false, reason: 'nothing-recorded' }, glances: { ok: true }, unraid: { ok: false, reason: 'not-configured' }, links: { ok: true } },
    };
}

module.exports = {
    shots: [
        {
            slug: 'quick-launch',
            kind: 'video',
            alt: 'The Quick launch panel opening in the middle of the dashboard, with bookmarks under Yours, Pinned and Most opened, and the pointer moving over two of them',
            viewport: { width: 1280, height: 800 },
            async setup(page, { openDashboard }) {
                await openDashboard(page);
                await page.evaluate(async () => {
                    const d = window.dashboardInstance;
                    await d.loadAllBookmarks?.();
                    d.settings.quickLaunchAdded = (d.bookmarks || []).slice(0, 3).map((b) => b.url);
                    await d.saveSettings();
                    window.QuickLaunch.sync();
                });
            },
            async act(page) {
                await page.keyboard.press('Shift+Q');
                const panel = page.locator('.modal.quick-launch-modal');
                await panel.waitFor();
                const tiles = panel.locator('.quick-launch-tile');
                await tiles.first().waitFor();
                // Pacing for the recording, not a condition: the panel is shown for a moment before the pointer moves.
                await page.waitForTimeout(1200);
                await tiles.nth(1).hover();
                // Pacing for the recording, not a condition: the pointer rests on the tile so the frame shows its hover state.
                await page.waitForTimeout(900);
                await tiles.nth(4).hover();
                // Pacing for the recording, not a condition: the last frame stays long enough to read.
                await page.waitForTimeout(1200);
            },
        },
        {
            slug: 'timeline',
            kind: 'image',
            alt: 'Config, Timeline: each day with a strip of 24 hours and a tick for every event, and an outage of Sonarr joined by a small chain to the automatic update that came a minute before it',
            viewport: { width: 1280, height: 800 },
            async setup(page, { openDashboard, settle }) {
                await page.route('**/api/timeline*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(timelineAnswer(Date.now())) }));
                await openDashboard(page);
                await page.locator('.config-link-anchor').click();
                await page.locator('[data-config-section="timeline"]').click();
                await page.locator('.tl-item').first().waitFor();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(800);
                await settle(page);
            },
        },
    ],
};
