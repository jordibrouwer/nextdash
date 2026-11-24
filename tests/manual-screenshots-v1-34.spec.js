// @ts-check
/*
 * The MANUAL.md screenshots of v1.34.0: the Quick launch panel, Config →
 * Timeline in its new look, and the line a bookmark's panel shows for an error
 * it was told not to report. Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-34.spec.js
 *
 * /api/timeline is answered by the spec with one invented story (Sonarr went
 * down a minute after its auto-update), as in the v1.33 spec, so the picture
 * shows the same thing on every machine; the real route has Go tests.
 */
const { test, prepare, settle, shot, snap, openDashboard, DESKTOP, NOW } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const SONARR_URL = 'http://sonarr.lan:8989/';
const at = (min) => NOW.getTime() - min * 60_000;

function timelineAnswer() {
    const now = NOW.getTime();
    const update = {
        id: 'u1', at: at(75), source: 'update', kind: 'update', by: 'auto', from: '4.0.9', to: '4.0.10',
        subject: { type: 'container', name: 'sonarr' }, link: '#service?container=sonarr', causeOf: ['d1'],
    };
    const down = {
        id: 'd1', at: at(74), end: at(60), durationMs: 14 * 60_000, source: 'health', kind: 'down', outage: true, count: 1,
        subject: { type: 'bookmark', name: 'Sonarr', key: 'sonarr.lan' }, link: `#service?url=${encodeURIComponent(SONARR_URL)}&page=1`,
        detail: 'HTTP 502', causes: [{ eventId: 'u1', gapMs: 60_000, relation: 'linked-bookmark', confidence: 'sure' }],
    };
    const cpu = {
        id: 'g1', at: at(26 * 60), end: at(26 * 60 - 10), durationMs: 10 * 60_000, source: 'glances', kind: 'cpu', outage: true,
        subject: { type: 'glances', name: 'Tower', key: 'main' }, link: '#glances', detail: 'peak 94',
    };
    const flap = {
        id: 'd2', at: at(30 * 60), end: at(30 * 60 - 3), durationMs: 3 * 60_000, source: 'health', kind: 'down', outage: true, count: 1,
        subject: { type: 'bookmark', name: 'Jellyfin', key: 'jellyfin.lan' }, link: '#service?container=jellyfin', detail: 'timeout',
    };
    return {
        generatedAt: now, from: now - 7 * 86_400_000, to: now, events: [down, update, cpu, flap], related: [],
        coverage: {
            docker: { ok: true }, update: { ok: true }, health: { ok: true }, check: { ok: false, reason: 'nothing-recorded' },
            glances: { ok: true }, unraid: { ok: false, reason: 'not-configured' }, links: { ok: true },
        },
    };
}

test('06 the Quick launch panel', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // The panel as a reader sets it up: a few bookmarks put in by hand, the rest pinned and most opened.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.loadAllBookmarks?.();
        d.settings.quickLaunchAdded = (d.bookmarks || []).slice(0, 3).map((b) => b.url);
        await d.saveSettings();
        window.QuickLaunch.sync();
    });
    await page.keyboard.press('Shift+Q');
    const panel = page.locator('.modal.quick-launch-modal');
    await panel.waitFor();
    await panel.locator('.quick-launch-tile').first().waitFor();
    // Pacing for the capture, not a condition: the panel finishes unfolding before the frame is taken.
    await page.waitForTimeout(800);
    await snap(page, panel, '06-quick-launch.jpg', { pad: 24 });
});

test('18 Config → Timeline, the new look', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/timeline*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(timelineAnswer()) }));
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="timeline"]').click();
    await page.locator('.tl-item').first().waitFor();
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await settle(page);
    await shot(page, '18-timeline.jpg');
});

test('12 an error told to stop reporting', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: a transition or a redraw gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await page.locator('#config-bm-search').fill('GitLab');
    // Pacing for the capture, not a condition: the list redraws for the search.
    await page.waitForTimeout(600);
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: /^GitLab$/ }) }).first().click();
    const panel = page.locator('#config-bm-panel');
    await panel.locator('.config-bm-panel-title', { hasText: /^GitLab$/ }).waitFor();
    // The real route a reader takes: the Health tab, then "Ignore this error for good" in its menu.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('2');
    const health = panel.locator('[data-bm-pane="health"]');
    await health.waitFor({ state: 'visible' });
    await page.keyboard.press('n');
    await panel.locator('.config-bm-health-ignored').first().waitFor();
    // Pacing for the capture, not a condition: the panel finishes redrawing.
    await page.waitForTimeout(600);
    await snap(page, panel, '12-ignored-error.jpg', { pad: 0 });
});
