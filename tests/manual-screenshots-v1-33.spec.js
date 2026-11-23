// @ts-check
/*
 * The MANUAL.md screenshots of v1.33.0: the Service overview, Config → Timeline
 * and the palette suggesting the command behind a typo. Same harness as the
 * other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-33.spec.js
 *
 * /api/service and /api/timeline are answered by the spec with one invented
 * story (Sonarr went down a minute after its auto-update), so the pictures show
 * the same thing on every machine; the real routes have Go tests.
 */
const { test, prepare, settle, shot, snap, crop, openDashboard, DESKTOP, NOW } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const SONARR_URL = 'http://sonarr.lan:8989/';
const at = (min) => NOW.getTime() - min * 60_000;

function serviceAnswer() {
    const now = NOW.getTime();
    const day = (n) => ({ d: Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()) - n * 86_400_000, n: 48, u: n === 1 ? 46 : 48 });
    return {
        bookmark: {
            found: true, name: 'Sonarr', url: SONARR_URL, pageId: 1, index: 0, pageName: 'Homelab', checkMode: 'monitor', status: 'healthy', score: 100,
            monitor: {
                uptime24h: { ratio: 1, samples: 48 }, uptime7d: { ratio: 0.9976, samples: 336 }, uptime30d: { ratio: 0.9991, samples: 1440 },
                lastPingMs: 84, totalChecks: 1440,
            },
        },
        days: Array.from({ length: 30 }, (_, i) => day(29 - i)),
        checks: [{ id: 'abcdef012345', type: 'tcp', label: 'TCP 8989', enabled: true, known: true, ok: true, at: now, since: now - 3_600_000, ms: 4 }],
        watches: [],
        container: {
            id: 'a'.repeat(64), name: 'sonarr', image: 'lscr.io/linuxserver/sonarr', state: 'running',
            ports: [{ private: 8989, public: 8989, type: 'tcp' }],
            startedAt: Math.floor((now - 3_600_000 * 20) / 1000), version: '4.0.10',
        },
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

test('15 the Service overview', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/service**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(serviceAnswer()) }));
    // The dashboard first (openDashboard closes any modal), then the deep link a reader would follow.
    await openDashboard(page);
    await page.evaluate((hash) => { window.location.hash = hash; }, `#service?url=${encodeURIComponent(SONARR_URL)}&page=1`);
    const dialog = page.locator('#app-modal.show .modal.service-modal');
    await dialog.waitFor();
    await dialog.locator('[data-service-hero]').waitFor();
    await snap(page, dialog, '15-service-overview.jpg', { pad: 0 });
});

test('18 Config → Timeline', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/timeline*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(timelineAnswer()) }));
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="timeline"]').click();
    await page.locator('.tl-item').first().waitFor();
    await page.waitForTimeout(800);
    await settle(page);
    await shot(page, '18-timeline.jpg');
});

test('08 the palette suggests the command behind a typo', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press(':');
    await page.locator('#shortcut-search .search-container').waitFor();
    await page.keyboard.type('dokcer');
    await page.locator('#search-matches .search-match', { hasText: 'DOCKER' }).first().waitFor();
    // Pacing for the capture, not a condition: the row finishes drawing before the frame is taken.
    await page.waitForTimeout(700);
    await crop(page, page.locator('#shortcut-search .search-container'), '08-command-typo.jpg');
});

// ---- Added after v1.33.0 was merged with dev: label rows and a date typed by hand.

test('09 label rows split a long category', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    const id = await page.evaluate(() => {
        const d = window.dashboardInstance;
        for (const cat of d.categories || []) {
            const list = document.querySelector(`.bookmarks-list[data-category-id="${CSS.escape(String(cat.id))}"]`);
            if (list && list.querySelectorAll('.bookmark-link').length >= 6) return String(cat.id);
        }
        return null;
    });
    test.skip(!id, 'no category with six rows in the seed');
    const category = page.locator(`.category[data-category-id="${id}"]`);
    // A category menu a reader would open: right-click the title, Add label, type a name.
    const nameLabel = async (name) => {
        const input = page.locator('.category-divider-input');
        await input.waitFor();
        await input.fill(name);
        await input.press('Enter');
    };
    await category.locator('.category-title').first().click({ button: 'right' });
    await page.locator('#category-context-menu [role="menuitem"]', { hasText: 'Add label' }).click();
    await nameLabel('Reference');
    // It lands at the end; Alt+Up moves it up between the rows, as a reader would.
    await page.locator('.category-divider', { hasText: 'Reference' }).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp');
    // The same from a bookmark's menu: a label above the fourth row.
    await category.locator('.bookmark-link').nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add label above' }).click();
    await nameLabel('Tools');
    await page.waitForTimeout(600);
    await snap(page, category, '09-label-rows.jpg', { pad: 14 });
});

/** The Bookmarks view by its header icon, as a reader opens it. */
async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('12 a domain date typed by hand', async ({ page }) => {
    await prepare(page);
    // The registry of .io has no RDAP service: the real report would say "no date".
    await page.route('**/api/bookmark-health**', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const issue of body.issues || []) {
            if (String(issue.url).includes('jwt.io')) issue.domain = 'jwt.io';
        }
        body.domainSummary = { enabled: true, watched: 1, noDate: [{ domain: 'jwt.io', state: 'unsupported' }] };
        await route.fulfill({ response, json: body });
    });
    await openBookmarksView(page);
    await page.evaluate(() => { window.dashboardInstance.settings.domainExpiry = true; });
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'JWT debugger' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await page.keyboard.press('2');
    await page.waitForTimeout(1_200);
    const section = panel.locator('details.config-bm-acc', { hasText: 'Expectations' }).first();
    await section.locator('summary').click();
    const input = section.locator('[data-domain-date]');
    await input.waitFor();
    await input.fill('2027-03-14');
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await snap(page, section, '12-domain-date.jpg', { pad: 8 });
});

test('16 the Timer widget', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // Added the way a reader adds it: Config -> Widgets -> Add a widget -> Timer.
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="widgets"]').click();
    await page.locator('[data-widget-catalogue]').first().click();
    await page.locator('#app-modal.show [data-widget-option="timer"]').first().click();
    await page.locator('#app-modal.show [data-widget-add="timer"]').click();
    const finish = page.locator('[data-widget-wizard-finish]');
    if (await finish.count()) await finish.click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await openDashboard(page);
    const tile = page.locator('[data-widget-id]', { has: page.locator('.dashboard-timer') }).first();
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await snap(page, tile, '16-timer-widget.jpg', { pad: 14 });
});
