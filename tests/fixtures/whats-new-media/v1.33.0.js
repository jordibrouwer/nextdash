// The highlights of v1.33.0: the Service overview, the timeline in Config and
// the Timer widget. See tests/whats-new-media.spec.js.
// /api/service and /api/timeline are answered by the plan with
// one invented story, so the pictures read the same on every machine.
const SONARR_URL = 'http://sonarr.lan:8989/';
const hour = 3_600_000;

function serviceAnswer(now) {
    const at = (min) => now - min * 60_000;
    const day = (n) => ({ d: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - n * 86_400_000, n: 48, u: n === 1 ? 46 : 48 });
    return {
        bookmark: {
            found: true, name: 'Sonarr', url: SONARR_URL, pageId: 1, index: 0, pageName: 'Homelab', checkMode: 'monitor', status: 'healthy', score: 100,
            monitor: { uptime24h: { ratio: 1, samples: 48 }, uptime7d: { ratio: 0.9976, samples: 336 }, uptime30d: { ratio: 0.9991, samples: 1440 }, lastPingMs: 84, totalChecks: 1440 },
        },
        days: Array.from({ length: 30 }, (_, i) => day(29 - i)),
        checks: [{ id: 'abcdef012345', type: 'tcp', label: 'TCP 8989', enabled: true, known: true, ok: true, at: now, since: now - hour, ms: 4 }],
        watches: [],
        container: { id: 'a'.repeat(64), name: 'sonarr', image: 'lscr.io/linuxserver/sonarr', state: 'running', ports: [{ private: 8989, public: 8989, type: 'tcp' }], startedAt: Math.floor((now - 20 * hour) / 1000), version: '4.0.10' },
        docker: { available: true },
        timeline: [
            { at: at(35), source: 'release', kind: 'release', detail: 'v4.0.11' },
            { at: at(60), source: 'health', kind: 'up', detail: 'back after 14 min' },
            { at: at(74), source: 'health', kind: 'down', detail: 'HTTP 502' },
            { at: at(75), source: 'docker', kind: 'update', detail: '4.0.9 → 4.0.10' },
        ],
        control: false, self: false, generatedAt: now,
    };
}

function timelineAnswer(now) {
    const at = (min) => now - min * 60_000;
    const update = { id: 'u1', at: at(75), source: 'update', kind: 'update', by: 'auto', from: '4.0.9', to: '4.0.10', subject: { type: 'container', name: 'sonarr' }, link: '#service?container=sonarr', causeOf: ['d1'] };
    const down = {
        id: 'd1', at: at(74), end: at(60), durationMs: 14 * 60_000, source: 'health', kind: 'down', outage: true, count: 1,
        subject: { type: 'bookmark', name: 'Sonarr', key: 'sonarr.lan' }, link: `#service?url=${encodeURIComponent(SONARR_URL)}&page=1`,
        detail: 'HTTP 502', causes: [{ eventId: 'u1', gapMs: 60_000, relation: 'linked-bookmark', confidence: 'sure' }],
    };
    const cpu = { id: 'g1', at: at(26 * 60), end: at(26 * 60 - 10), durationMs: 10 * 60_000, source: 'glances', kind: 'cpu', outage: true, subject: { type: 'glances', name: 'Tower', key: 'main' }, link: '#glances', detail: 'peak 94' };
    return {
        generatedAt: now, from: now - 7 * 86_400_000, to: now, events: [down, update, cpu], related: [],
        coverage: { docker: { ok: true }, update: { ok: true }, health: { ok: true }, check: { ok: false, reason: 'nothing-recorded' }, glances: { ok: true }, unraid: { ok: false, reason: 'not-configured' }, links: { ok: true } },
    };
}

module.exports = {
    shots: [
        {
            slug: 'service-overview',
            kind: 'image',
            alt: 'The Service overview of Sonarr: All good, 30-day uptime, response time, the container with its image and version, and a timeline with an update, an outage of 14 minutes and a new release',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('#app-modal.show .modal.service-modal'),
            async setup(page, { openDashboard }) {
                await page.route('**/api/service**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(serviceAnswer(Date.now())) }));
                await openDashboard(page);
                await page.evaluate((hash) => { window.location.hash = hash; }, `#service?url=${encodeURIComponent(SONARR_URL)}&page=1`);
                await page.locator('#app-modal.show .modal.service-modal [data-service-hero]').waitFor();
            },
        },
        {
            slug: 'timeline',
            kind: 'image',
            alt: 'Config, Timeline: an outage of Sonarr for 14 minutes, with the line Likely cause, 1 min after sonarr auto-updated 4.0.9 to 4.0.10',
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
        {
            slug: 'timer',
            kind: 'image',
            alt: 'A Timer tile: a ring around 01:00, four presets, a box for your own and a Start button',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('[data-widget-id]', { has: page.locator('.dashboard-timer') }).first(),
            async setup(page, { openDashboard }) {
                await openDashboard(page);
                await page.locator('.config-link-anchor').click();
                await page.locator('[data-config-section="widgets"]').click();
                await page.locator('[data-widget-catalogue]').first().click();
                await page.locator('#app-modal.show [data-widget-option="timer"]').first().click();
                await page.locator('#app-modal.show [data-widget-add="timer"]').click();
                const finish = page.locator('[data-widget-wizard-finish]');
                if (await finish.count()) await finish.click();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(800);
                await page.keyboard.press('Escape');
                await openDashboard(page);
                await page.locator('[data-widget-id]', { has: page.locator('.dashboard-timer') }).first().scrollIntoViewIfNeeded();
            },
        },
    ],
};
