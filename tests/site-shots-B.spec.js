// @ts-check
/*
 * nextdash.cc feature-page pictures, batch B: dashboard, finders, glances,
 * languages and logs. Full frames of the app in the kit's default theme
 * (Tarnished Brass dark), 1440x900 (phones: 390x844 at twice the pixels).
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=2 \
 *     npx playwright test tests/site-shots-B.spec.js
 */
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const {
    test,
    prepare,
    settle,
    shot,
    openDashboard,
    DESKTOP,
    PHONE,
    OUT,
    DAY,
    readJSON,
    writeJSON,
} = require('./helpers/manual-shot-kit');
const { mockGlances } = require('./helpers/glances-mock');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

/** A change to this test's copy of settings.json. */
const settingsTweak = (patch) => ({
    run(dir) {
        const file = path.join(dir, 'settings.json');
        writeJSON(file, { ...readJSON(file), ...patch });
    },
});

/** A full frame that leaves focus where it is (the one picture whose subject is a focused field). */
async function shotKeepFocus(page, name) {
    const view = page.viewportSize() || DESKTOP;
    await page.mouse.move(5, view.height - 5);
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(300);
    fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true });
    await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 82 });
}

/** Config, by the gear in the header, then a section on its rail. */
async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.locator('.config-view').waitFor();
    await settle(page);
}
const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/* ───────────────────────────── dashboard ───────────────────────────── */

test('dashboard 1: the dashboard', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await shot(page, 'dashboard/shot-1.jpg');
});

test('dashboard 2: Homelab with the week overview', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#2');
    await page.locator('.date-time-line').first().click();
    await page.locator('#date-popover').waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the popover finishes opening before the frame is taken.
    await page.waitForTimeout(700);
    await shot(page, 'dashboard/shot-2.jpg');
});

test.describe('action buttons in the header', () => {
    test.use({ dataTweak: settingsTweak({ actionBarPosition: 'header', showActionKeys: true, actionBarAutoHideSeconds: 0 }) });
    test('dashboard 3: the folded buttons in a menu', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        const more = page.locator('.header-shortcuts .header-action-overflow');
        await more.waitFor({ state: 'visible' });
        await more.click();
        await page.locator('.header-action-menu, .header-overflow-menu, [role="menu"]').first().waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the menu finishes opening before the frame is taken.
        await page.waitForTimeout(600);
        await shot(page, 'dashboard/shot-3.jpg');
    });
});

test('dashboard 4: edit mode with the Code category chosen', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+M');
    await page.locator('body[data-edit-mode="on"]').waitFor();
    await page.locator('#dashboard-layout .category[data-category-id="code"] .category-title').first().click();
    await page.locator('#edit-mode-panel [data-edit-section="category"]').waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the panel finishes sliding in before the frame is taken.
    await page.waitForTimeout(600);
    await shot(page, 'dashboard/shot-4.jpg');
});

test('dashboard 5: the preview card of a bookmark', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.locator('#dashboard-layout .category[data-category-id="code"] .bookmark-link', { hasText: 'GitHub' }).first().hover();
    const card = page.locator('.bookmark-preview-card').first();
    await card.waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the card's picture and numbers settle before the frame is taken.
    await page.waitForTimeout(1_200);
    // The pointer has to stay on the row; the frame is taken without moving it.
    fs.mkdirSync(path.join(OUT, 'dashboard'), { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'dashboard/shot-5.jpg'), type: 'jpeg', quality: 82 });
});

test.describe('on a phone', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    test('phones 1: the Dev page', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        const note = page.getByRole('button', { name: 'Dismiss' }).first();
        if (await note.isVisible().catch(() => false)) await note.click();
        await page.locator('h1').first().click().catch(() => {});
        // The page scrolls up until Today stands at the top, so the widgets after it fit in the frame.
        await page.evaluate(() => {
            const today = document.querySelector('#dashboard-layout .category[data-smart-collection="true"]');
            window.scrollTo(0, Math.max(0, today.getBoundingClientRect().top + window.scrollY - 14));
        });
        // Pacing for the capture, not a condition: the tap's highlight fades and the scroll settles before the frame is taken.
        await page.waitForTimeout(800);
        await shot(page, 'phones/shot-1.jpg');
    });
});

/* ───────────────────────────── finders ───────────────────────────── */

/** The seed's six finders plus Wikipedia on w (the pictures after the first show seven). */
const withWikipedia = {
    run(dir) {
        const file = path.join(dir, 'finders.json');
        writeJSON(file, [...readJSON(file), { name: 'Wikipedia', searchUrl: 'https://en.wikipedia.org/w/index.php?search=%s', shortcut: 'w' }]);
    },
};

test('finders 1: the finders tab', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('!');
    await page.locator('#shortcut-search .search-container').waitFor();
    // Pacing for the capture, not a condition: the list finishes drawing before the frame is taken.
    await page.waitForTimeout(800);
    await shotKeepFocus(page, 'finders/shot-1.jpg');
});

test.describe('seven finders', () => {
test.use({ dataTweak: withWikipedia });
test('finders 2: Config, Finders', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => { window.location.hash = '#config/finders'; });
    await page.locator('[data-config-section="finders"].active, [data-config-section="finders"][aria-current], .config-view').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the table finishes drawing before the frame is taken.
    await page.waitForTimeout(800);
    await shot(page, 'finders/shot-2.jpg');
});

test('finders 3: ?W raspberry pi', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('!');
    await page.locator('#shortcut-search .search-container').waitFor();
    await page.keyboard.type('W raspberry pi', { delay: 30 });
    // Pacing for the capture, not a condition: the list narrows before the frame is taken.
    await page.waitForTimeout(800);
    await shotKeepFocus(page, 'finders/shot-3.jpg');
});
});

test('finders 4: no matches for zqxkw', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('>');
    await page.locator('#shortcut-search .search-container').waitFor();
    await page.keyboard.type('zqxkw', { delay: 30 });
    // Pacing for the capture, not a condition: the rows finish drawing before the frame is taken.
    await page.waitForTimeout(900);
    await shotKeepFocus(page, 'finders/shot-4.jpg');
});

/* ───────────────────────────── glances ───────────────────────────── */

/** The Glances page, opened with its header icon. */
async function openGlances(page, section = 'overview') {
    await prepare(page);
    await mockGlances(page);
    await openDashboard(page);
    await page.locator('#page-nav-glances-link').click();
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    // Pacing for the capture, not a condition: the tour is offered once on a first visit and settle closes it.
    await page.waitForTimeout(1_500);
    await settle(page);
    if (section !== 'overview') await page.locator(`[data-glances-section="${section}"]`).click();
    // Pacing for the capture, not a condition: the tab finishes drawing before the frame is taken.
    await page.waitForTimeout(800);
}

test('glances 1: overview', async ({ page }) => {
    await openGlances(page);
    await expect(page.locator('[data-glances-block="figures"]')).toBeVisible();
    await shot(page, 'glances/shot-1.jpg');
});

test('glances 2: history', async ({ page }) => {
    await openGlances(page, 'history');
    await page.locator('[data-glances-chart]').first().waitFor();
    await page.locator('[data-glances-incident]').first().waitFor();
    await shot(page, 'glances/shot-2.jpg');
});

test('glances 3: processes', async ({ page }) => {
    await openGlances(page, 'processes');
    await page.locator('[data-glances-pid]').first().waitFor();
    await page.locator('[data-glances-pid]', { hasText: 'jellyfin' }).first().click();
    await page.locator('[data-glances-drawer]').first().waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the side panel finishes drawing before the frame is taken.
    await page.waitForTimeout(1_000);
    await shot(page, 'glances/shot-3.jpg');
});

test('glances 5: insights', async ({ page }) => {
    // Everything the alt text lists is on one tab; a tall frame holds it all.
    await page.setViewportSize({ width: 1440, height: 3400 });
    await openGlances(page, 'insights');
    await page.locator('[data-glances-insight="day"]').waitFor();
    await shot(page, 'glances/shot-5.jpg');
});

test.describe('the widgets', () => {
    test.use({ dataPatch: 'glances', dataTweak: settingsTweak({ showGridKeyLegend: false }) });
    test('glances 4: two widgets beside Processor and Memory', async ({ page }) => {
        await prepare(page);
        await mockGlances(page);
        await openDashboard(page);
        const last = await page.evaluate(() => window.dashboardInstance.pages.length);
        await openDashboard(page, `#${last}`);
        const tile = (type) => page.locator(`[data-widget-type="${type}"]`);
        const graph = tile('glances').filter({ has: page.locator('a[href$="host=vps"]') });
        await expect(graph.locator('svg.dashboard-widget-glances-spark path')).toBeVisible();
        await expect(tile('glances').filter({ has: page.locator('a[href$="host=main"]') })).toContainText('homelab');
        // Pacing for the capture, not a condition: the meters finish drawing before the frame is taken.
        await page.waitForTimeout(1_000);
        await shot(page, 'glances/shot-4.jpg');
    });
});

/* ───────────────────────────── languages ───────────────────────────── */

test.describe('Dutch', () => {
    test.use({ dataTweak: settingsTweak({ language: 'nl' }) });
    test('languages 1: Dutch', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await shot(page, 'languages/shot-1.jpg');
    });
});

test.describe('Chinese', () => {
    test.use({ dataTweak: settingsTweak({ language: 'zh' }) });
    test('languages 2: Chinese', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await shot(page, 'languages/shot-2.jpg');
    });
});

test('languages 3: Config, Behavior, General, Language', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'behavior');
    await subtab(page, 'General').click();
    const select = page.locator('[data-behavior-field="language"]').first();
    await select.waitFor();
    await select.scrollIntoViewIfNeeded();
    await select.focus();
    // Pacing for the capture, not a condition: the focus ring finishes drawing before the frame is taken.
    await page.waitForTimeout(500);
    await shotKeepFocus(page, 'languages/shot-3.jpg');
});

test('languages 4: the Type panel', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
    await page.locator('#look-studio-tab-layout').click();
    const xl = page.locator('[data-look-studio] [data-appearance-font="xl"]');
    await xl.waitFor();
    await xl.scrollIntoViewIfNeeded();
    const box = await xl.boundingBox();
    // The pointer goes to the middle of the button once; the preview changes the layout under it, so no retrying hover.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Pacing for the capture, not a condition: the dashboard behind takes the previewed size before the frame is taken.
    await page.waitForTimeout(800);
    const view = page.viewportSize() || DESKTOP;
    fs.mkdirSync(path.join(OUT, 'languages'), { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'languages/shot-4.jpg'), type: 'jpeg', quality: 82 });
    expect(view.width).toBe(1440);
});

test.describe('XL text', () => {
    test.use({ dataTweak: settingsTweak({ fontSize: 'xl' }) });
    test('languages 5: the dashboard at XL', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await shot(page, 'languages/shot-5.jpg');
    });
});

/* ───────────────────────────── logs ───────────────────────────── */

/*
 * The server log as the shots' clock would have it: 44 lines in the last
 * minutes, two warnings and one error. Made-up addresses and titles only.
 */
const LOG_ROWS = [
    ['09:00:01', 'info', 'server', 'nextDash starting on :8099'],
    ['09:00:01', 'info', 'server', 'data directory ready, 3 pages and 101 bookmarks loaded'],
    ['09:00:01', 'info', 'server', 'settings loaded, theme tarnished-brass-dark'],
    ['09:00:02', 'info', 'server', 'icon cache ready, 94 icons'],
    ['09:00:02', 'info', 'server', 'ready to answer requests'],
    ['09:00:03', 'info', 'status', 'monitors started: 11 bookmarks checked every 5 minutes'],
    ['09:00:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:02:11', 'info', 'request', 'GET /api/pages 200 1204B 2.1ms'],
    ['09:02:11', 'info', 'request', 'GET /api/settings 200 9822B 3.4ms'],
    ['09:02:12', 'info', 'request', 'GET /api/bookmarks?page=1 200 18310B 6.8ms'],
    ['09:02:12', 'info', 'request', 'GET /api/bookmark-health 200 41228B 13.4ms'],
    ['09:02:13', 'info', 'request', 'GET /api/inbox 200 3120B 1.9ms'],
    ['09:03:40', 'info', 'request', 'GET /api/update-status 200 186B 1.2ms'],
    ['09:05:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:08:30', 'info', 'request', 'POST /api/bookmarks 200 98B 7.7ms'],
    ['09:08:31', 'info', 'server', 'bookmark saved: Homelab wiki'],
    ['09:10:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:11:02', 'info', 'request', 'GET /api/bookmarks?page=2 200 21044B 7.2ms'],
    ['09:11:03', 'info', 'request', 'GET /api/widgets/rss?pageId=2 200 2210B 41.0ms'],
    ['09:12:48', 'info', 'request', 'POST /api/bookmarks/12/archive 200 412B 1180.4ms'],
    ['09:12:49', 'info', 'archive', 'saved a copy of https://wiki.example.org/homelab (142 KB)'],
    ['09:13:20', 'info', 'request', 'GET /data/icons/wiki.png 200 4210B 0.6ms'],
    ['09:15:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:16:41', 'info', 'request', 'GET /api/inbox 200 3120B 1.8ms'],
    ['09:17:10', 'info', 'request', 'GET /api/system/metrics 200 1402B 4.6ms'],
    ['09:18:22', 'info', 'request', 'POST /api/bookmarks/31/archive 502 61B 3004.9ms', 'error'],
    ['09:18:22', 'warn', 'archive', 'could not save a copy of https://docs.example.net/guide: connection refused'],
    ['09:20:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:21:33', 'info', 'request', 'GET /api/pages 200 1204B 1.9ms'],
    ['09:21:34', 'info', 'request', 'GET /api/settings 200 9822B 3.1ms'],
    ['09:22:15', 'info', 'server', 'docker socket found, 7 containers listed'],
    ['09:23:50', 'info', 'request', 'PUT /api/bookmarks/40 200 98B 6.4ms'],
    ['09:24:12', 'warn', 'import', 'skipped 3 duplicate links while importing bookmarks.html'],
    ['09:24:12', 'info', 'import', 'imported 18 links into Inbox'],
    ['09:25:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:26:40', 'info', 'request', 'GET /api/inbox 200 4488B 2.2ms'],
    ['09:27:02', 'info', 'request', 'GET /api/bookmark-health 200 41228B 12.9ms'],
    ['09:28:19', 'info', 'request', 'GET /api/update-status 200 186B 1.1ms'],
    ['09:29:44', 'info', 'request', 'GET /api/widgets/rss?pageId=2 200 2210B 38.5ms'],
    ['09:30:05', 'info', 'status', 'checked 11 monitors: 11 online'],
    ['09:31:12', 'info', 'request', 'GET /api/system/metrics 200 1402B 4.2ms'],
    ['09:32:08', 'info', 'request', 'GET /api/pages 200 1204B 2.0ms'],
    ['09:33:30', 'info', 'request', 'GET /api/bookmarks?page=1 200 18310B 6.5ms'],
    ['09:34:01', 'info', 'server', 'settings saved'],
].map(([time, level, source, message, override], seq) => ({
    seq,
    level: override || level,
    source,
    time: new Date(`${DAY}T${time}`).toISOString(),
    message: `${(0x5a17c0de + seq * 0x1f3d).toString(16).padStart(8, '0')}${(0x9e3779b9 * (seq + 1) >>> 0).toString(16).padStart(8, '0')} ${message}`,
}));

/** The log as the server answers it: since, level and q honoured; the tiles count the whole buffer. */
async function mockServerLog(page) {
    await page.route('**/api/logs?**', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const params = new URL(route.request().url()).searchParams;
        const since = Number(params.get('since') ?? -1);
        const level = params.get('level') || '';
        const q = (params.get('q') || '').toLowerCase();
        const entries = LOG_ROWS.filter((e) => e.seq > since
            && (!level || (level === 'warn' && e.level !== 'info') || (level === 'error' && e.level === 'error'))
            && (!q || `${e.source} ${e.message}`.toLowerCase().includes(q)));
        return route.fulfill({
            json: {
                epoch: 'site',
                entries,
                nextSeq: LOG_ROWS.length,
                capacity: 2000,
                stats: { total: LOG_ROWS.length, warn: LOG_ROWS.filter((e) => e.level === 'warn').length, error: LOG_ROWS.filter((e) => e.level === 'error').length },
            },
        });
    });
}

/** The refresh select sits in the closed popover; set it the way its change handler expects. */
async function setInterval30(page) {
    await page.locator('[data-log-select="interval"]').evaluate((el) => {
        el.value = '30';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function openServerLog(page) {
    await prepare(page);
    await mockServerLog(page);
    await openConfig(page, 'logs');
    await setInterval30(page);
    await page.locator('[data-log-output] .config-log-line').first().waitFor();
    await expect(page.locator('[data-log-output] .config-log-line')).toHaveCount(LOG_ROWS.length);
    // Pacing for the capture, not a condition: the tiles and lines finish drawing before the frame is taken.
    await page.waitForTimeout(600);
}

test.describe('server log', () => {
    test.use({ dataPatch: 'serverlog' });

    test('logs 1: the server log', async ({ page }) => {
        await openServerLog(page);
        await shot(page, 'logs/shot-1.jpg');
    });

    test('logs 2: warnings and errors', async ({ page }) => {
        await openServerLog(page);
        await page.locator('[data-log-select="level"]').selectOption('warn');
        await expect(page.locator('[data-log-output] .config-log-line')).toHaveCount(3);
        await shot(page, 'logs/shot-2.jpg');
    });

    test('logs 3: filtered on archive', async ({ page }) => {
        await openServerLog(page);
        await page.locator('[data-log-search]').fill('archive');
        await expect(page.locator('[data-log-output] .config-log-line')).toHaveCount(4);
        await shot(page, 'logs/shot-3.jpg');
    });

    test('logs 4: the log settings', async ({ page }) => {
        await openServerLog(page);
        await page.locator('[data-log-settings-toggle]').click();
        await page.locator('#config-log-settings-popover').waitFor({ state: 'visible' });
        await page.locator('[data-log-select="retention"]').selectOption('0');
        await expect(page.locator('[data-log-output] .config-log-line')).toHaveCount(LOG_ROWS.length);
        await page.locator('#config-log-settings-popover').waitFor({ state: 'visible' });
        // The "Saved" note the change leaves in the corner goes away before the frame is taken.
        await page.locator('.is-saved').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        await expect(page.locator('.is-saved')).toHaveCount(0, { timeout: 15_000 });
        await shot(page, 'logs/shot-4.jpg');
    });
});

test('logs 5: the activity trail', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'logs');
    await subtab(page, 'Activity trail').click();
    await page.locator('[data-activity-channel]').first().waitFor();
    // Pacing for the capture, not a condition: the cards finish drawing before the frame is taken.
    await page.waitForTimeout(800);
    await shot(page, 'logs/shot-5.jpg');
});
