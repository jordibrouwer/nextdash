// @ts-check
/*
 * Loop videos for nextdash.cc feature pages, set LC: logs, notes-and-digest,
 * pages-and-categories, phones. One WebM per page, 1440x900, Tarnished Brass
 * dark, on the public demo seed.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=1 \
 *     npx playwright test tests/site-loops-LC.spec.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const {
    test,
    prepare,
    settle,
    openDashboard,
    readJSON,
    writeJSON,
    NOW,
    DAY,
    DESKTOP,
    PHONE,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'loops run on purpose only');
test.use({ viewport: DESKTOP, reducedMotion: 'reduce', video: { mode: 'on', size: { width: 1440, height: 900 } } });
test.setTimeout(180_000);

const OUT = process.env.SHOTS_OUT;

/** Close the page, then cut the video from the moment the loop began. */
async function finishLoop(page, slug, t0, startAt, seconds, context) {
    const video = page.video();
    await page.close();
    if (context) await context.close();
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    // saveAs waits until the file is finished.
    const src = path.join(dir, 'raw.webm');
    await video.saveAs(src);
    fs.writeFileSync(path.join(dir, 'loop.json'), JSON.stringify({ startAt, video: src, seconds, recorded: (Date.now() - t0) / 1000 }));
    // The same cut as trim-loop.sh, with the realtime encoder: the default one takes minutes on a busy machine.
    const out = path.join(dir, 'loop.webm');
    execFileSync('ffmpeg', [
        '-v', 'error', '-y', '-ss', String(startAt), '-t', String(seconds), '-i', src,
        '-vf', 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0x0e1210',
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-an', out,
    ], { stdio: 'inherit' });
}

/** Seconds since the video began. */
const since = (t0) => (Date.now() - t0) / 1000;
/** A rest between two actions of the loop. */
// Pacing for the capture, not a condition: the viewer needs time to read the frame.
const rest = (page, ms) => page.waitForTimeout(ms);

const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.locator('.config-view').waitFor();
    await settle(page);
}

/* ───────────────────────────── logs ───────────────────────────── */

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

async function mockServerLog(page) {
    await page.route('**/api/logs?**', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const params = new URL(route.request().url()).searchParams;
        const sinceSeq = Number(params.get('since') ?? -1);
        const level = params.get('level') || '';
        const q = (params.get('q') || '').toLowerCase();
        const entries = LOG_ROWS.filter((e) => e.seq > sinceSeq
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

test.describe('loop logs', () => {
    test.use({ dataPatch: 'serverlog' });

    test('loop logs', async ({ page }) => {
        const t0 = Date.now();
        await prepare(page);
        await mockServerLog(page);
        await openConfig(page, 'logs');
        await page.locator('[data-log-select="interval"]').evaluate((el) => {
            el.value = '30';
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const lines = page.locator('[data-log-output] .config-log-line');
        await expect(lines).toHaveCount(LOG_ROWS.length);
        await page.mouse.move(700, 880);
        await rest(page, 800);
        const startAt = since(t0);

        await rest(page, 1_200);
        // Show: Warnings & errors, everything else steps aside.
        await page.locator('[data-log-select="level"]').selectOption('warn');
        await expect(lines).toHaveCount(3);
        await rest(page, 2_200);
        await page.locator('[data-log-select="level"]').selectOption('');
        await expect(lines).toHaveCount(LOG_ROWS.length);
        await rest(page, 900);
        // Filter lines: archive.
        await page.locator('[data-log-search]').click();
        await page.keyboard.type('archive', { delay: 150 });
        await expect(lines).toHaveCount(4);
        await rest(page, 2_200);
        await page.locator('[data-log-search]').fill('');
        await expect(lines).toHaveCount(LOG_ROWS.length);
        await page.locator('[data-log-search]').blur();
        await rest(page, 1_200);

        await finishLoop(page, 'logs', t0, startAt, since(t0) - startAt);
    });
});

/* ───────────────────────────── notes-and-digest ───────────────────────────── */

const NOTE_ARCH = 'Start with the installation guide, the ZFS chapter is the one I need for the NAS';

function notesData(dir) {
    const file = path.join(dir, 'bookmarks-1.json');
    const data = readJSON(file);
    const notes = { 'Arch Wiki': NOTE_ARCH, 'tldr pages': 'The short version when man pages are too much' };
    for (const b of data.bookmarks) if (notes[b.name]) b.note = notes[b.name];
    writeJSON(file, data);
}

const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();

test.describe('loop notes', () => {
    test.use({ dataTweak: { run: notesData } });

    test('loop notes-and-digest', async ({ page }) => {
        const t0 = Date.now();
        await prepare(page);
        await openDashboard(page);
        // The digest is made ahead, so the command has one to open.
        const made = await page.request.post('/api/digest/test');
        const digestReady = made.status() !== 204;
        // The new digest brings its corner card; it is put away before the loop starts.
        const cards = page.locator('.notice-card.show [data-notice-dismiss]');
        await cards.first().waitFor({ timeout: 8_000 }).catch(() => {});
        while (await cards.count()) {
            await cards.first().click();
            await page.locator('.notice-card.show').first().waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
        }
        // Arch Wiki in view before the loop starts, so nothing scrolls during it.
        await row(page, 'Arch Wiki').scrollIntoViewIfNeeded();
        await page.mouse.move(8, 450);
        await rest(page, 800);
        const scrollY = await page.evaluate(() => window.scrollY);
        const startAt = since(t0);

        await rest(page, 1_000);
        // Point at the bookmark: the preview card shows the note.
        await row(page, 'Arch Wiki').hover();
        const card = page.locator('.bookmark-preview-card').first();
        await card.waitFor({ state: 'visible' });
        await card.getByText(NOTE_ARCH.slice(0, 30)).first().waitFor();
        await rest(page, 1_900);
        await page.mouse.move(8, 450);
        await card.waitFor({ state: 'hidden' });
        await rest(page, 500);
        // Right-click, Edit: the Note field is filled in.
        await row(page, 'Arch Wiki').click({ button: 'right' });
        await page.locator('.bookmark-context-menu').first().getByText(/^Edit/).first().click();
        const form = page.getByRole('dialog', { name: 'Edit Bookmark' });
        await form.waitFor();
        await form.getByText('Note', { exact: true }).waitFor();
        await rest(page, 1_900);
        await page.keyboard.press('Escape');
        await form.waitFor({ state: 'hidden' });
        await page.mouse.move(8, 450);
        await rest(page, 500);
        // :digest opens the latest weekly digest.
        if (digestReady) {
            await page.keyboard.press(':');
            await page.keyboard.type('digest', { delay: 130 });
            await page.keyboard.press('Enter');
            await page.locator('.digest-modal .digest-window').waitFor({ timeout: 15_000 });
            await rest(page, 2_100);
            await page.keyboard.press('Escape');
            await page.locator('.digest-modal .digest-window').waitFor({ state: 'hidden' });
            // The digest's corner card comes back once it was read; it is put away again.
            await rest(page, 800);
            while (await cards.count()) {
                await cards.first().click();
                await page.locator('.notice-card.show').first().waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
            }
        }
        // The digest window moves the page; it goes back to where the loop began.
        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await rest(page, 900);

        await finishLoop(page, 'notes-and-digest', t0, startAt, since(t0) - startAt);
    });
});

/* ───────────────────────────── pages-and-categories ───────────────────────────── */

const noLegend = { run(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, { ...readJSON(file), showGridKeyLegend: false });
} };

test.describe('loop pages', () => {
test.use({ dataTweak: noLegend });
test('loop pages-and-categories', async ({ page }) => {
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page, '#3');
    const privacy = page.locator('#dashboard-layout .category[data-category-id="privacy"]').first();
    await privacy.waitFor();
    await privacy.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 170));
    await page.mouse.move(8, 450);
    await rest(page, 800);
    const startAt = since(t0);

    await rest(page, 1_000);
    // The pages panel.
    await page.keyboard.press(',');
    await page.locator('.page-overview-modal').waitFor({ state: 'visible' });
    await rest(page, 2_000);
    await page.keyboard.press('Escape');
    await page.locator('.page-overview-modal').waitFor({ state: 'hidden' });
    await rest(page, 700);
    // Sort Privacy A to Z: the chip shows in the header.
    await privacy.locator('.category-sort-menu-btn').first().click();
    await page.locator('.category-sort-menu').waitFor({ state: 'visible' });
    await rest(page, 1_000);
    await page.locator('.category-sort-menu-item[data-sort-mode="az"]').first().click();
    await privacy.locator('.category-sort-controls').getByText(/A.?Z/).first().waitFor();
    await page.mouse.move(8, 450);
    await rest(page, 1_800);
    // The chip goes back to manual order.
    await privacy.locator('.category-sort-controls .category-sort-btn').first().click();
    await expect(privacy.locator('.category-sort-controls')).toHaveAttribute('data-sort-mode', 'order');
    await page.mouse.move(8, 450);
    await rest(page, 900);
    // The header's own menu, by right-click.
    await page.locator('#category-title-privacy').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await rest(page, 2_200);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.mouse.move(8, 450);
    await rest(page, 1_200);

    await finishLoop(page, 'pages-and-categories', t0, startAt, since(t0) - startAt);
});
});

/* ───────────────────────────── phones ───────────────────────────── */

/** A sideways swipe, as the page's touch pointer handlers see it. */
async function swipe(page, fromX, toX, y) {
    await page.evaluate(({ fromX: a, toX: b, y: yy }) => {
        const target = document.elementFromPoint(a, yy) || document.body;
        const fire = (type, x) => target.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: yy,
        }));
        fire('pointerdown', a);
        for (let i = 1; i <= 6; i += 1) fire('pointermove', a + ((b - a) * i) / 6);
        fire('pointerup', b);
    }, { fromX, toX, y });
}

test('loop phones', async ({ browser, server }) => {
    // The video size differs from the desktop loops, so this context is made by hand.
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'loop-phone-'));
    const context = await browser.newContext({
        baseURL: server.baseURL,
        viewport: PHONE,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
        recordVideo: { dir, size: { width: 390, height: 844 } },
    });
    const page = await context.newPage();
    {
        const t0 = Date.now();
        await prepare(page);
        await openDashboard(page);
        const note = page.getByRole('button', { name: 'Dismiss' }).first();
        if (await note.isVisible().catch(() => false)) await note.click();
        await page.locator('h1').first().click().catch(() => {});
        await rest(page, 800);
        const startAt = since(t0);
        const firstPage = await page.evaluate(() => String(window.dashboardInstance?.currentPageId));
        let clock = NOW.getTime();
        const tick = async () => { clock += 2_000; await page.clock.setFixedTime(new Date(clock)); };

        await rest(page, 1_200);
        // Swipe sideways: the next page, then back.
        await swipe(page, 320, 60, 450);
        await page.waitForFunction((id) => String(window.dashboardInstance?.currentPageId) !== id, firstPage, { timeout: 10_000 });
        await rest(page, 2_000);
        await tick();
        await swipe(page, 60, 320, 450);
        await page.waitForFunction((id) => String(window.dashboardInstance?.currentPageId) === id, firstPage, { timeout: 10_000 });
        await rest(page, 1_400);
        // Search, with its mode tabs.
        // The key the stills use: the header's search icon is not in the phone's header here.
        await page.keyboard.press('>');
        await page.locator('#shortcut-search .search-container').waitFor({ timeout: 10_000 });
        await rest(page, 1_000);
        for (const mode of ['command', 'finder', 'tag']) {
            await page.locator(`.search-mode-tab[data-mode="${mode}"]`).tap();
            await rest(page, 1_100);
        }
        await page.locator('#search-clear').tap();
        await page.locator('#shortcut-search .search-container').waitFor({ state: 'hidden' });
        await rest(page, 1_200);

        await finishLoop(page, 'phones', t0, startAt, since(t0) - startAt, context);
    }
});
