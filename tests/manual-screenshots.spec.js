// @ts-check
/*
 * The screenshots in MANUAL.md, taken through the real UI.
 *
 * Run on purpose only, against a copy of the demo data:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<copy of data-demo> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots.spec.js
 *
 * Without MANUAL_SHOTS every test skips, so a normal run never takes them.
 *
 * Every test gets a server of its own on a free port, started from the binary
 * global setup builds, over its own copy of NEXTDASH_DATA_DIR -- so one shot
 * that adds a widget or dismisses a card leaves the next one alone, and the
 * tests can run side by side. The copy is tidied first (tidyDemoData): the
 * demo's own monitors cannot reach their example hosts, and a server left
 * running on it records them all as down.
 *
 * What a real install would get from outside -- Docker, the weather, the
 * status pings, an Unraid server, a service behind the Custom widget -- is
 * answered here with fixtures from tests/fixtures/manual-screenshots and the
 * fixtures the feature specs already use. The browser clock stands at
 * 06-10-2026 09:12.
 *
 * Views open the way a reader opens them: the key (`&`, `:`, `!`, Shift+A),
 * the header icon, a right-click.
 */
const {
    base,
    fs,
    http,
    net,
    os,
    path,
    ROOT,
    OUT,
    FIX,
    json,
    fixture,
    unraidAnswer,
    NOW,
    DESKTOP,
    PHONE,
    TABLET,
    DEMO_THEME,
    freePort,
    waitForServer,
    readJSON,
    writeJSON,
    pingFor,
    tidyDemoData,
    BROKEN_HOSTS,
    test,
    prepare,
    settle,
    shot,
    crop,
    boxAround,
    snap,
    openDashboard,
    spawn,
    binaryPath,
    mockDocker,
    markWhatsNewSeen,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);


test('04 dashboard', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await shot(page, '04-dashboard.jpg');
    // The bar slides into the edge after two seconds; ' brings it back and keeps it.
    await page.keyboard.press("'");
    const bar = page.locator('.dashboard-section.section-controls .header-shortcuts');
    await page.waitForTimeout(600);
    await crop(page, bar, '04-action-buttons.jpg', 24);
});

test('sh homelab', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#2');
    await shot(page, 'sh-homelab.jpg');
});

/** Let a toast that is on its way come and go (it lasts a few seconds). */
async function waitOutNotice(page) {
    const toast = page.locator('#app-notification.show');
    await toast.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

/** A bookmark row on the grid, by its name. */
const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();
const modal = (page) => page.locator('#app-modal.show .modal');

test('04 preview card', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await row(page, 'Maps').hover();
    const card = page.locator('.bookmark-preview-card').first();
    await card.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_200);
    await crop(page, card, '04-preview-card.jpg');
});

test('05 quick add', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('&');
    const input = page.locator('#omnibox-overlay .omnibox-input');
    await input.waitFor();
    await input.pressSequentially('Jellyfin | https://jellyfin.lab.example | jf', { delay: 10 });
    await page.waitForTimeout(800);
    await crop(page, page.locator('#omnibox-overlay .omnibox-box'), '05-quick-add.jpg');
});

test('05 full form', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('+');
    const form = page.getByRole('dialog', { name: 'Create New Bookmark' });
    await form.waitFor();
    // The form opens with the cursor in URL.
    await page.waitForTimeout(400);
    await page.keyboard.type('https://jellyfin.lab.example', { delay: 10 });
    await page.waitForTimeout(1_000);
    await crop(page, form, '05-full-form.jpg');
});

test('06 context menu', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await row(page, 'Encyclopedia').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await crop(page, menu, '06-context-menu.jpg');
});

test('07 cheat sheet', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('!');
    await page.locator('#app-modal.show .keyboard-cheat-sheet-modal').waitFor();
    await page.waitForTimeout(600);
    await crop(page, modal(page), '07-cheat-sheet.jpg');
});

test('08 search', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // Bare letters look for a shortcut first; / turns the same letters into a
    // name search, as the panel's own hint says.
    await page.keyboard.type('lib', { delay: 120 });
    await page.keyboard.press('/');
    await page.waitForTimeout(800);
    await crop(page, page.locator('#shortcut-search .search-container'), '08-search.jpg');
});

test('08 commands', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press(':');
    await page.waitForTimeout(800);
    await crop(page, page.locator('#shortcut-search .search-container'), '08-commands.jpg');
});

test('09 smart collections', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await crop(page, page.locator('#dashboard-layout .category[data-smart-collection="true"]').first(), '09-smart-collections.jpg', 16);
});

/** The Bookmarks view, by its header icon. */
async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('11 bookmarks view', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'Encyclopedia' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(1_000);
    await shot(page, '11-bookmarks-view.jpg');
    await crop(page, panel, '11-side-panel.jpg', 0);
});

test('11 collection health', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('h');
    await modal(page).waitFor();
    await page.waitForTimeout(1_500);
    await crop(page, modal(page), '11-collection-health.jpg');
});

/** Config, by the gear in the header, then a section on its rail. */
async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.waitForTimeout(800);
    await settle(page);
}

const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/** Scroll the page so an element stands near the top, below the sticky head. */
async function scrollToTop(page, locator, offset = 140) {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, box.y - offset);
    await page.waitForTimeout(500);
    await settleScroll(page);
}

/*
 * Nudge the scroll so no line of text is cut in half where the page meets
 * the top of the window, or the bottom of a sticky header standing there.
 * Tries a pixel at a time, nearest first, up to 30 either way.
 */
async function settleScroll(page) {
    const nudge = await page.evaluate(() => {
        const cx = Math.round(window.innerWidth / 2);
        let edge = 0;
        let sticky = null;
        for (const x of [cx, 300, window.innerWidth - 300]) {
            for (let el = document.elementFromPoint(x, 2); el && el !== document.body; el = el.parentElement) {
                const pos = getComputedStyle(el).position;
                if (pos === 'sticky' || pos === 'fixed') {
                    const bottom = el.getBoundingClientRect().bottom;
                    if (bottom > edge && bottom < window.innerHeight / 3) { edge = bottom; sticky = el; }
                    break;
                }
            }
        }
        const boxes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const el = node.parentElement;
            if (!el || (sticky && sticky.contains(el))) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) {
                if (r.height > 0 && r.bottom > edge - 40 && r.top < edge + 40) boxes.push([r.top, r.bottom]);
            }
        }
        document.querySelectorAll('input, select, textarea, button, img, svg').forEach((el) => {
            if (sticky && sticky.contains(el)) return;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > edge - 40 && r.top < edge + 40) boxes.push([r.top, r.bottom]);
        });
        const cut = (d) => boxes.some(([top, bottom]) => top - d < edge - 1 && bottom - d > edge + 1);
        for (let i = 0; i <= 30; i += 1) {
            for (const d of i ? [i, -i] : [0]) if (!cut(d)) return d;
        }
        return 0;
    });
    if (nudge) {
        await page.mouse.wheel(0, nudge);
        await page.waitForTimeout(400);
    }
}

test('12 alerts', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'monitoring');
    await subtab(page, 'Notifications').click();
    const heading = page.getByRole('heading', { name: /^Downtime alerts/ }).first();
    await heading.waitFor();
    await scrollToTop(page, heading);
    await shot(page, '12-alerts.jpg');
});

/** The inbox, by its header icon. */
async function openInbox(page) {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await page.locator('.inbox-layout').waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('13 inbox', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    await page.locator('.inbox-layout').getByText('Field notes on quokkas').first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await shot(page, '13-inbox.jpg');
});

test('13 triage', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    await page.locator('.inbox-triage-btn').click();
    await page.locator('#inbox-triage-overlay').waitFor();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);
    await crop(page, page.locator('#inbox-triage-overlay .inbox-triage-card'), '13-triage.jpg');
});

/** The Containers view, by its header icon. */
async function openContainers(page) {
    await openDashboard(page);
    await page.locator('#page-nav-docker-host .docker-link-anchor').click();
    await page.locator('[data-docker-row]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('14 containers', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await shot(page, '14-containers.jpg');
});

test('14 side panel', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'sonarr' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await crop(page, panel, '14-side-panel.jpg', 0);
});

test('14 disk', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await page.keyboard.press('d');
    await page.getByText('Bind mounts').first().waitFor();
    await page.waitForTimeout(1_000);
    // Down past the header, so the first bind mounts are in the frame.
    await scrollToTop(page, page.getByText('Disk', { exact: true }).first(), 16);
    await shot(page, '14-disk.jpg');
});

/*
 * The logs window reads an NDJSON stream that stays open. A route answers in
 * one piece and the stream would end at once, so fetch() for that path hands
 * back a stream that has these lines in it and stays open, as a running
 * container's log does (the same trick as docker-logs-modal.spec.js).
 */
const SONARR_LOG = [
    ['07:00:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:00:04', 'out', '[Info] DownloadDecisionMaker: Processing 48 releases'],
    ['07:00:06', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 48, Reports grabbed: 0'],
    ['07:05:11', 'out', '[Info] RefreshSeriesService: Updating info for Slow Horses'],
    ['07:05:12', 'out', '[Info] DiskScanService: Scanning disk for Slow Horses'],
    ['07:05:13', 'out', '[Info] DiskScanService: Completed scanning disk for Slow Horses'],
    ['07:15:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:15:03', 'err', '[Warn] Newznab: Indexer returned HTTP 503, retrying in 5 minutes'],
    ['07:15:05', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 31, Reports grabbed: 1'],
    ['07:15:06', 'out', '[Info] DownloadService: Report sent to qBittorrent. Slow Horses S05E04 1080p WEB'],
    ['07:30:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:30:05', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 29, Reports grabbed: 0'],
    ['07:41:19', 'out', '[Info] DownloadedEpisodesImportService: Importing Slow Horses S05E04'],
    ['07:41:21', 'out', '[Info] EpisodeFileMovingService: Moving file to /tv/Slow Horses/Season 05'],
    ['07:41:22', 'out', '[Info] Jellyfin: Library refresh requested'],
    ['07:45:02', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['07:45:04', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 35, Reports grabbed: 0'],
    ['08:00:00', 'out', '[Info] HousekeepingService: Running housekeeping tasks'],
    ['08:00:02', 'out', '[Info] Database: Vacuuming log database'],
    ['08:00:03', 'out', '[Info] Database: Log database compressed'],
    ['08:00:04', 'out', '[Info] RssSyncService: Starting RSS Sync'],
    ['08:00:07', 'out', '[Info] RssSyncService: RSS Sync Completed. Reports found: 40, Reports grabbed: 0'],
    // Written in local time (the clock in the shots); Docker stamps in UTC.
].map(([time, s, m]) => ({ t: new Date(`2026-10-06T${time}`).toISOString().replace('.000Z', '.000000000Z'), s, m }));

async function fakeLogStream(page, lines) {
    await page.addInitScript((logLines) => {
        const encoder = new TextEncoder();
        const real = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (!url.includes('/logs/stream')) return real(input, init);
            const body = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(logLines.map((l) => `${JSON.stringify(l)}\n`).join('')));
                },
            });
            return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
        };
    }, lines);
}

test('14 logs window', async ({ page }) => {
    await prepare(page);
    await fakeLogStream(page, SONARR_LOG);
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'sonarr' }).first().click({ button: 'right' });
    await page.getByText('Show logs', { exact: false }).first().click();
    const logs = page.locator('.docker-logs-modal');
    await logs.waitFor({ state: 'visible' });
    await page.getByText('Library refresh requested').first().waitFor();
    await page.waitForTimeout(800);
    await crop(page, logs, '14-logs-window.jpg');
});

test('15 widgets', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#2');
    // Down the Homelab page to where the machine's own widgets stand.
    await scrollToTop(page, page.locator('[data-widget-type="cpu"]').first(), 120);
    await page.waitForTimeout(800);
    await shot(page, '15-widgets.jpg');
});

/**
 * A service for the Custom widget to ask: it answers every path with the
 * Sonarr queue recorded in tests/fixtures/widget-presets/sonarr.json.
 */
async function startSonarrStub() {
    const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'widget-presets', 'sonarr.json'), 'utf8'));
    const answer = { ...recorded.body, totalCount: 4, count: 3, unknownCount: 1 };
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {import('net').AddressInfo} */ (server.address());
    return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Config -> Widgets -> Add a widget -> Custom, as step 1 of §15.5 says. */
async function addCustomWidget(page) {
    await openConfig(page, 'widgets');
    await page.locator('[data-widget-catalogue]').first().click();
    await page.locator('#app-modal.show [data-widget-option="custom"]').first().click();
    await page.locator('#app-modal.show [data-widget-add="custom"]').click();
    const preset = page.locator('[data-widget-preset]').last();
    await preset.waitFor();
    return preset;
}

test('15 custom widget', async ({ page }) => {
    const stub = await startSonarrStub();
    try {
        await prepare(page);
        /*
         * Ask now goes through the real server, which asks the stub and reads
         * the figures out of its answer. The address on screen stays the one
         * a reader would type; only the request is pointed at the stub, and
         * the host in the answer is put back.
         */
        await page.route('**/api/widgets/custom/test', async (route) => {
            const sent = JSON.parse(route.request().postData() || '{}');
            const shown = new URL(sent.url);
            sent.url = `${stub.origin}${shown.pathname}`;
            const response = await route.fetch({ postData: JSON.stringify(sent) });
            const body = await response.json();
            body.host = shown.host;
            body.tookMs = 38;
            await route.fulfill({ response, json: body });
        });
        const preset = await addCustomWidget(page);
        await preset.selectOption('sonarr');
        await page.waitForTimeout(600);
        const address = page.locator('[data-widget-setting="url"]').last();
        await address.fill('http://sonarr.lab.example:8989/api/v3/queue/status');
        await address.press('Tab');
        await page.locator('[data-widget-auth="secret"]').last().fill('demo-key-not-a-real-one');
        await page.locator('[data-custom-test]').last().click();
        await page.getByText('What came back').first().waitFor();
        // The preset's notice goes by itself; the figures are the subject here.
        await waitOutNotice(page);
        await page.waitForTimeout(1_000);
        await scrollToTop(page, page.locator('[data-custom-field="path"]').first(), 260);
        await shot(page, '15-custom-widget.jpg');
    } finally {
        await stub.close();
    }
});

test('15 custom widget presets', async ({ page }) => {
    await prepare(page);
    const preset = await addCustomWidget(page);
    await preset.selectOption('sonarr');
    // The preset's notice goes by itself; it would cover the figures.
    await waitOutNotice(page);
    await page.waitForTimeout(800);
    const group = page.locator('.config-custom-group', { has: page.locator('[data-widget-preset]') }).last();
    await scrollToTop(page, group, 200);
    await shot(page, '15-custom-widget-presets.jpg');
});

test.describe('unraid', () => {
    test.use({ dataPatch: 'unraid' });
    test('15 unraid widgets', async ({ page }) => {
        await prepare(page);
        await openDashboard(page, '#4');
        await page.waitForTimeout(1_000);
        await shot(page, '15-unraid-widgets.jpg');
    });
});

test('16 look studio', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    const studio = page.locator('[data-look-studio]');
    await studio.waitFor({ state: 'visible' });
    await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
    await page.waitForTimeout(1_200);
    await shot(page, '16-look-studio.jpg');
    // The Themes tab close up: search, segments, character chips, first cards.
    await crop(page, studio, '16-theme-browser.jpg', 0, 560);
});

test('16 theme editor', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    await subtab(page, 'Look').click();
    await page.getByRole('button', { name: /Open the theme editor/ }).first().click();
    // Recolour the theme on screen: its colours open below.
    await page.locator('[data-theme-base-select]').selectOption('matrix-bluepill-dark');
    await page.waitForTimeout(1_500);
    await scrollToTop(page, page.locator('[data-theme-base-select]'), 200);
    await shot(page, '16-theme-editor.jpg');
});

test('17 config', async ({ page }) => {
    await prepare(page);
    await openConfig(page);
    await page.waitForTimeout(1_000);
    await shot(page, '17-config.jpg');
});

test('18 statistics', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'stats');
    await page.waitForTimeout(2_000);
    await shot(page, '18-statistics.jpg');
});

test('19 backups', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'data-backups');
    await subtab(page, 'Backups').click();
    await page.waitForTimeout(1_200);
    await shot(page, '19-backups.jpg');
});

test('20 activity trail', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'logs');
    await subtab(page, 'Activity trail').click();
    await page.waitForTimeout(1_200);
    await shot(page, '20-activity-trail.jpg');
});

test.describe('phone', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
    test('22 phone', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // The one-time note about the phone layout, closed with its ×.
        const note = page.getByRole('button', { name: 'Dismiss' }).first();
        if (await note.isVisible().catch(() => false)) await note.click();
        // The tap leaves the row under it lit; a tap on the title lets go.
        await page.locator('h1').first().click().catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, '22-phone.jpg');
    });
});

/*
 * Close crops of single elements, set beside the text that names them.
 *
 * Each one is reached the way a reader reaches it -- a key, a click, a
 * right-click -- and cropped tight with snap(), so the element fills the
 * picture and no hover glow, focus ring or toast is left in it.
 */

test.describe('category count', () => {
    test.use({ dataPatch: 'catcount' });
    test('04 header and grid parts', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await snap(page, page.locator('.dashboard-section.section-controls .header-top'), '04-header.jpg');
        await snap(page, [page.locator('.header-track'), page.locator('.header-destinations')], '04-page-switcher.jpg');
        await snap(page, row(page, 'Encyclopedia'), '04-bookmark-row.jpg', { pad: 8 });
        const header = page.locator('#category-title-utilities');
        await scrollToTop(page, header, 300);
        await snap(page, header, '04-category-header.jpg', { pad: 10 });
    });
});

test('05 paste prompt', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // A paste with no field active, as Ctrl + V on the dashboard sends it.
    await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', 'https://jellyfin.lab.example/web/');
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    const dialog = page.locator('#paste-choice-modal .paste-choice-modal');
    await dialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await snap(page, dialog, '05-paste-prompt.jpg', { pad: 4 });
});

test('06 qr code', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+J');
    await page.locator('#app-modal.show .bookmark-qr-modal').waitFor();
    await page.waitForTimeout(800);
    await snap(page, modal(page), '06-qr-code.jpg', { pad: 4 });
});

test.describe('header sheets', () => {
    // The sheet that hangs from the header is centred by a transform, which
    // the reduced-motion rule in modal.css takes away (it then runs off the
    // right edge); the shot shows it as most readers see it.
    test.use({ reducedMotion: 'no-preference' });
    test('06 recent', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('*');
        await page.locator('#app-modal.show .recent-bookmarks-modal').waitFor();
        await page.waitForTimeout(1_000);
        await snap(page, modal(page), '06-recent.jpg', { pad: 4 });
    });
});

test('06 edit in place', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+E');
    const form = page.getByRole('dialog', { name: 'Edit Bookmark' });
    await form.waitFor();
    await page.waitForTimeout(1_200);
    // The form opens with the cursor in the address field; that stays.
    await snap(page, form, '06-edit-in-place.jpg', { pad: 4, keepFocus: true });
});

test('07 focus and selection', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    const today = page.locator('#dashboard-layout .category[data-smart-collection="true"]').first();
    await snap(page, today, '07-focus.jpg', { keepFocus: true });
    // x ticks the row and moves on.
    await page.keyboard.press('x');
    await page.keyboard.press('x');
    await page.keyboard.press('x');
    const bar = page.locator('.multi-select-toolbar');
    await bar.waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await snap(page, bar, '07-selection-bar.jpg', { pad: 8 });
});

test('08 finders', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('?');
    await page.waitForTimeout(800);
    await snap(page, page.locator('#shortcut-search .search-container'), '08-finders.jpg', { pad: 4, keepFocus: true });
});

test('08 tag cloud', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('/');
    const cloud = page.locator('#tag-cloud-modal.is-open');
    await cloud.waitFor();
    await page.waitForTimeout(800);
    // The cloud opens with its keyboard cursor on the first tag, a box that
    // reads as a selection in a still picture; the shot leaves it off.
    await page.evaluate(() => document.querySelectorAll('#tag-cloud-modal .is-keyboard-focused')
        .forEach((el) => el.classList.remove('is-keyboard-focused')));
    // Its bottom edge is see-through; the last pixels show the page below.
    const cloudBox = await cloud.boundingBox();
    await snap(page, cloud, '08-tag-cloud.jpg', { pad: 0, maxHeight: Math.floor(cloudBox.height) - 4 });
});

const WEB_RESULTS = [
    { title: 'Maps of the world - OpenStreetMap', url: 'https://www.openstreetmap.org/', snippet: 'OpenStreetMap is a map of the world, created by people like you and free to use.', domain: 'openstreetmap.org' },
    { title: 'Topographic maps for hiking', url: 'https://topo.maps.example/', snippet: 'Contour lines, trails and huts, for every country in Europe.', domain: 'topo.maps.example' },
    { title: 'A short history of maps', url: 'https://history.maps.example/short', snippet: 'From clay tablets to satellites: how people drew the world they knew.', domain: 'history.maps.example' },
];

test.describe('web search', () => {
    test.use({ dataPatch: 'websearch' });
    test('08 web search', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/web-search/status', (r) => r.fulfill({ json: { engine: 'searxng', configured: true, categories: ['web', 'news', 'videos', 'it'] } }));
        await page.route('**/api/web-search?**', (r) => r.fulfill({ json: { engine: 'searxng', results: WEB_RESULTS } }));
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.waitForTimeout(400);
        await page.keyboard.type('maps', { delay: 60 });
        await page.waitForTimeout(800);
        await page.keyboard.press('Shift+Enter');
        await page.locator('#search-matches .search-web-result').first().waitFor();
        await page.waitForTimeout(800);
        await snap(page, page.locator('#shortcut-search .search-container'), '08-web-search.jpg', { pad: 4, keepFocus: true });
    });
});

test('09 category menu', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.locator('#category-title-dev').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await snap(page, menu, '09-category-menu.jpg', { pad: 0, keepFocus: true });
});

test('10 tag suggestions', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('+');
    await page.getByRole('dialog', { name: 'Create New Bookmark' }).waitFor();
    await page.waitForTimeout(400);
    // A second page on a site whose bookmark carries #dev: the form offers it.
    await page.keyboard.type('https://github.com/jellyfin/jellyfin', { delay: 10 });
    await page.keyboard.press('Tab');
    const chips = page.locator('.tag-suggest-chips');
    await chips.waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await snap(page, page.locator('.bookmark-inline-field', { has: chips }), '10-tag-suggestions.jpg');
});

test('11 rail, toolbar and header band', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await snap(page, page.locator('.config-view--library .lvs-header'), '11-header-band.jpg', { pad: 8 });
    await snap(page, page.locator('.config-bm-toolbar'), '11-toolbar.jpg', { pad: 8 });
    // The summary, Views and Health; Pages, Categories and Tags follow below.
    // The crop stops where Health ends, before the next heading.
    const railTop = [page.locator('#config-bm-rail .config-bm-health-summary'), page.locator('#config-bm-rail .config-bm-rail-group').nth(1)];
    const railBox = await boxAround(railTop);
    await snap(page, railTop, '11-rail.jpg', { pad: 10, maxHeight: Math.floor(railBox.height) + 10 });
});

test('11 row menu', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'openstreetmap.org' }).first().click({ button: 'right' });
    const menu = page.locator('.config-bm-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await snap(page, menu, '11-row-menu.jpg', { pad: 0, keepFocus: true });
});

test('11 pages and categories', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    // Manage, beside Categories in the rail.
    await page.locator('#config-bm-rail [data-bm-manage="categories"]').click();
    const structure = page.locator('.modal.config-structure-modal');
    await structure.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await snap(page, structure, '11-pages-categories.jpg', { pad: 4 });
});

/** A monitored bookmark's side panel, on its Health tab. */
async function openHealthTab(page, host) {
    await openBookmarksView(page);
    await page.locator('#config-bm-list .config-bm-row', { hasText: host }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await page.keyboard.press('2');
    await page.waitForTimeout(1_200);
    return panel;
}

test('12 health tab', async ({ page }) => {
    await prepare(page);
    const panel = await openHealthTab(page, 'media.lab.example');
    await snap(page, panel, '12-health-tab.jpg', { pad: 0, maxHeight: 560 });
});

test('12 expected response', async ({ page }) => {
    await prepare(page);
    const panel = await openHealthTab(page, 'media.lab.example');
    const section = panel.locator('details.config-bm-acc', { hasText: 'Expectations' }).first();
    await section.locator('summary').click();
    await page.waitForTimeout(600);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await snap(page, section, '12-expected-response.jpg', { pad: 8 });
});

test.describe('drift', () => {
    test.use({ dataPatch: 'drift' });
    test('12 drift', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        // Work through, on the pile of pages that changed.
        await page.keyboard.press('f');
        await page.locator('.health-focus-pile', { hasText: 'Changed or wrong content' }).click();
        const card = page.locator('.health-focus-overlay .health-focus-card').first();
        await card.locator('.health-drift-badge').waitFor();
        await page.waitForTimeout(800);
        await snap(page, card, '12-drift.jpg', { pad: 4 });
    });
});

test('12 maintenance and quiet hours', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'monitoring');
    await subtab(page, 'Schedules').click();
    const panel = (title) => page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: title }) }).first();
    const windows = panel(/^Maintenance windows/);
    await scrollToTop(page, windows, 120);
    await snap(page, windows, '12-maintenance.jpg', { pad: 10 });
    const quiet = panel(/^Quiet hours/);
    await scrollToTop(page, quiet, 120);
    await quiet.getByText('Hold notices during quiet hours').click();
    await waitOutNotice(page);
    await quiet.getByRole('button', { name: /Add window/ }).click();
    await waitOutNotice(page);
    await page.waitForTimeout(600);
    await scrollToTop(page, quiet, 120);
    await snap(page, quiet, '12-quiet-hours.jpg', { pad: 10 });
});

test('13 inbox row', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    // A row carries no buttons of its own: its actions are in its menu (and
    // the side panel). The crop is the whole row with the menu it opened.
    const item = page.locator('.inbox-item', { hasText: 'Field notes on quokkas' }).first();
    await item.locator('.inbox-item-title').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await snap(page, [item, menu], '13-inbox-row.jpg', { pad: 4, keepFocus: true });
});

test('14 container row', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await snap(page, page.locator('[data-docker-row]', { hasText: 'sonarr' }).first(), '14-container-row.jpg', { pad: 8 });
});

test('14 config panels', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'containers');
    const panel = (title) => page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: title }) }).first();
    await snap(page, panel(/^Connection/), '14-connection.jpg', { pad: 10 });
    await subtab(page, 'Alerts').click();
    await page.waitForTimeout(800);
    await snap(page, panel(/^Notifications/), '14-notice.jpg', { pad: 10 });
});

test('15 widget tiles', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await snap(page, page.locator('[data-widget-type="notes"]').first(), '15-notes.jpg', { pad: 10 });
    await page.keyboard.press('2');
    await page.locator('[data-widget-type="uptime"]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(1_500);
    for (const [type, name] of [['uptime', '15-uptime.jpg'], ['containers', '15-container-list.jpg']]) {
        const tile = page.locator(`[data-widget-type="${type}"]`).first();
        await scrollToTop(page, tile, 120);
        await snap(page, tile, name, { pad: 10 });
    }
});

const RSS_ITEMS = [
    { title: 'Notes on small software', link: 'https://blog.reading.example/small-software', source: 'blog.reading.example', publishedAt: NOW.getTime() - 3 * 3_600_000 },
    { title: 'The router that ran for nine years', link: 'https://news.lab.example/router', source: 'news.lab.example', publishedAt: NOW.getTime() - 26 * 3_600_000 },
    { title: 'Why plain text lasts', link: 'https://blog.reading.example/plain-text', source: 'blog.reading.example', publishedAt: NOW.getTime() - 2 * 86_400_000 },
    { title: 'A quieter fan curve for the NAS', link: 'https://news.lab.example/fan-curve', source: 'news.lab.example', publishedAt: NOW.getTime() - 3 * 86_400_000 },
    { title: 'Backups you have tried to restore', link: 'https://blog.reading.example/restore', source: 'blog.reading.example', publishedAt: NOW.getTime() - 5 * 86_400_000 },
];

test.describe('widget page', () => {
    test.use({ dataPatch: 'widgets' });
    test('15 weather, feed and system tiles', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/widgets/rss?**', (r) => r.fulfill({ json: { items: RSS_ITEMS } }));
        await openDashboard(page, '#4');
        await page.waitForTimeout(1_000);
        await snap(page, [page.locator('[data-widget-type="cpu"]'), page.locator('[data-widget-type="memory"]'), page.locator('[data-widget-type="disks"]')], '15-system.jpg', { pad: 10 });
        await page.keyboard.press('5');
        await page.locator('[data-widget-type="weather"]').first().waitFor();
        await settle(page);
        await page.waitForTimeout(1_500);
        for (const [type, name] of [['weather', '15-weather.jpg'], ['rss', '15-rss.jpg']]) {
            await snap(page, page.locator(`[data-widget-type="${type}"]`).first(), name, { pad: 10 });
        }
    });
});

test('16 theme browser parts', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
    await page.waitForTimeout(1_200);
    await snap(page, page.locator('[data-look-studio] .theme-browser-characters').first(), '16-character-chips.jpg', { pad: 8 });
    const pane = page.locator('#look-studio-pane');
    // Each cut where a row or a card ends, so nothing stands half in it.
    for (const [tab, name, height] of [['backdrop', '16-backdrops.jpg', 596], ['looks', '16-looks.jpg', 585]]) {
        await page.locator(`#look-studio-tab-${tab}`).click();
        await page.waitForTimeout(1_200);
        await snap(page, pane, name, { pad: 0, maxHeight: height });
    }
});

test.describe('quiet hours on', () => {
    test.use({ dataPatch: 'quiet' });
    test('17 find settings and only changed', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'appearance');
        const head = page.locator('.config-view > .config-view-head').first();
        const headBox = await head.boundingBox();
        // Down to the head's own edge: the tabs start right under it.
        await snap(page, head, '17-only-changed.jpg', { pad: 6, maxHeight: Math.floor(headBox.height) + 6 });
        await page.keyboard.press('ControlOrMeta+Shift+K');
        const finder = page.locator('#app-modal.show .config-settings-jump-modal');
        await finder.waitFor();
        await finder.locator('input').first().click();
        await page.keyboard.type('quiet', { delay: 60 });
        await page.waitForTimeout(800);
        await snap(page, finder, '17-find-settings.jpg', { pad: 4, keepFocus: true });
    });
});

test('19 trash', async ({ page }) => {
    await prepare(page);
    // The server stamps a deletion with its own time; the shots' clock stands
    // at 09:12, so the two are put a little before it.
    await page.route('**/api/trash', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = await response.json();
        (body.items || []).forEach((item, i) => { item.deletedAt = NOW.getTime() - (i + 1) * 40 * 60_000; });
        return route.fulfill({ response, json: body });
    });
    await openBookmarksView(page);
    // Two bookmarks deleted the ordinary way, so the trash has something in it.
    for (const host of ['deepl.com', 'imdb.com']) {
        await page.locator('#config-bm-list .config-bm-row', { hasText: host }).first().click();
        await page.waitForTimeout(400);
        await page.keyboard.press('Escape');
        await page.keyboard.press('d');
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await page.waitForTimeout(800);
    }
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="data-backups"]').click();
    await subtab(page, 'Trash').click();
    await waitOutNotice(page);
    const panel = page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: 'Deleted items' }) }).first();
    await panel.waitFor();
    await page.waitForTimeout(600);
    await snap(page, panel, '19-trash.jpg', { pad: 10 });
});

test('19 webhooks', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'data-backups');
    await subtab(page, 'Webhooks').click();
    await page.waitForTimeout(800);
    const receiver = page.locator('.config-panel, details', { hasText: 'Add a receiver' }).last();
    await receiver.getByText('Add a receiver').first().click();
    await page.waitForTimeout(800);
    await scrollToTop(page, receiver, 120);
    await snap(page, receiver, '19-webhooks.jpg', { pad: 10 });
});

/*
 * The server log as the shots' clock would have it: request lines from the
 * last few minutes. A live server writes the real time of day, which would
 * stand ten hours from the 09:12 everywhere else.
 */
const SERVER_LOG = [
    ['09:10:02', 'GET /api/pages 200 1204B 2.1ms'],
    ['09:10:02', 'GET /api/settings 200 9822B 3.4ms'],
    ['09:10:03', 'GET /api/bookmarks?page=1 200 18310B 6.8ms'],
    ['09:10:03', 'GET /api/bookmark-health 200 41228B 13.4ms'],
    ['09:10:03', 'GET /api/inbox 200 3120B 1.9ms'],
    ['09:10:04', 'GET /api/docker/status 200 186B 0.9ms'],
    ['09:10:04', 'GET /api/widgets/rss?pageId=2 200 2210B 41.0ms'],
    ['09:10:31', 'POST /api/health/check-url 200 212B 188.2ms'],
    ['09:11:05', 'GET /api/update-status 200 186B 1.2ms'],
    ['09:11:40', 'GET /data/icons/missing-icon.png 404 19B 0.4ms', 'warn'],
    ['09:11:52', 'POST /api/bookmarks 200 98B 7.7ms'],
    ['09:12:00', 'GET /api/system/metrics 200 1402B 4.6ms'],
].map(([time, msg, level], seq) => ({
    seq,
    level: level || 'info',
    source: 'request',
    time: new Date(`2026-10-06T${time}`).toISOString(),
    message: `${(0x5a17c0de + seq * 0x1f3d).toString(16).padStart(8, '0')}${(0x9e3779b9 * (seq + 1) >>> 0).toString(16).padStart(8, '0')} ${msg}`,
}));

test.describe('server log', () => {
    test.use({ dataPatch: 'serverlog' });
    test('20 server logs', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/logs?**', (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            return route.fulfill({ json: { epoch: 'manual', entries: SERVER_LOG, nextSeq: SERVER_LOG.length, capacity: 2000, stats: { total: SERVER_LOG.length, warn: 1, error: 0 } } });
        });
        await openConfig(page, 'logs');
        await subtab(page, 'Server logs').click();
        await page.waitForTimeout(1_500);
        const panel = page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: /^Server log/ }) }).first();
        await scrollToTop(page, panel, 120);
        await snap(page, panel, '20-server-logs.jpg', { pad: 10, maxHeight: 620 });
    });
});

test.describe('phone bookmarks', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
    test('22 phone bookmarks', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        const note = page.getByRole('button', { name: 'Dismiss' }).first();
        if (await note.isVisible().catch(() => false)) await note.click();
        // The header leaves the Bookmarks icon out at this width; the view's
        // own address opens it.
        await page.goto('/#bookmarks');
        await page.locator('#config-bm-list .config-bm-row').first().waitFor();
        await settle(page);
        await page.waitForTimeout(1_000);
        await shot(page, '22-phone-bookmarks.jpg');
    });
});

/*
 * Full pages, folded under their subsections: the whole window where the
 * manual had no picture of it yet. The test names start with "full" and two
 * digits, so the set can be taken on its own with --grep "full \d\d ".
 *
 * Not taken as full frames: the cheat sheet, triage and Pages & categories.
 * Each is a modal of a fixed size over blurred haze, and at 1440 x 900 the
 * haze is most of the frame; their crops above already show them at 1:1.
 */

test.describe('new install', () => {
    test.use({ dataPatch: 'empty' });
    test('full 02 first launch', async ({ page }) => {
        await prepare(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 30_000 });
        // The quick-start card is the subject; settle() would close it.
        await page.locator('.quickstart-checklist').waitFor({ state: 'visible' });
        await page.waitForTimeout(1_500);
        await shot(page, '02-first-launch.jpg');
    });
});

test('full 09 second page', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // The page switcher's key: 3 is Reading.
    await page.keyboard.press('3');
    await page.locator('#category-title-articles').waitFor();
    await settle(page);
    await page.waitForTimeout(1_500);
    await shot(page, '09-second-page.jpg');
});

test.describe('spread', () => {
    test.use({ dataPatch: 'spread' });
    // Parked: in a spread category the list's column gap falls between every
    // track of a row, not only between the columns, and leaves each name a
    // track of a few dozen pixels ("Weather r..."). A picture of that would
    // teach the bug; take it once the layout is fixed.
    test.fixme('full 09 spread across columns', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.locator('#category-title-utilities').click({ button: 'right' });
        const menu = page.locator('.bookmark-context-menu').first();
        await menu.waitFor({ state: 'visible' });
        await menu.getByText('Spread across columns').first().click();
        await waitOutNotice(page);
        await settle(page);
        await page.waitForTimeout(800);
        await scrollToTop(page, page.locator('#category-title-utilities'), 160);
        await shot(page, '09-spread-columns.jpg');
    });
});

test('full 04 density', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    await subtab(page, 'Grid').click();
    // The Compact preset alone changes little at the demo's row height; Dense
    // beside it is what makes the page visibly tighter.
    await page.locator('select[data-behavior-field="layoutPreset"]').selectOption('compact');
    await waitOutNotice(page);
    await page.locator('select[data-behavior-field="densityMode"]').selectOption('dense');
    await waitOutNotice(page);
    // Back to the dashboard the way config is left.
    await page.keyboard.press('Escape');
    await page.locator('.category').first().waitFor();
    await settle(page);
    // A corner card can arrive after the first settle.
    await page.waitForTimeout(1_500);
    await settle(page);
    await shot(page, '04-density.jpg');
});

test.describe('broken', () => {
    test.use({ dataPatch: 'broken' });
    test('full 11 broken', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/ping?**', (route) => {
            const url = new URL(route.request().url()).searchParams.get('url') || '';
            if (!BROKEN_HOSTS.some((h) => url.includes(h))) return route.fallback();
            return route.fulfill({ json: { status: 'offline', ping: null, error: url.includes('gone') ? 'DNS lookup failed' : 'HTTP 404' } });
        });
        await openBookmarksView(page);
        await page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]').click();
        await page.waitForTimeout(800);
        await page.locator('#config-bm-list .config-bm-row', { hasText: 'kitchen.reading.example' }).first().click();
        await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
        await page.waitForTimeout(1_000);
        await shot(page, '11-broken.jpg');
    });
});

// Parked: the Unsorted group header and side panel show the raw page id 999999.
test.fixme('full 11 unsorted', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-rail [data-bm-rail="cleanup"][data-value="unsorted"]').click();
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'trails.kept.example' }).first().click();
    const panel = page.locator('[data-lvs-drawer-panel]').first();
    await panel.waitFor({ state: 'visible' });
    await panel.getByRole('button', { name: 'Promote' }).first().waitFor();
    await page.waitForTimeout(1_000);
    await shot(page, '11-unsorted.jpg');
});

test('full 11 health in large', async ({ page }) => {
    await prepare(page);
    await openBookmarksView(page);
    await page.locator('#config-bm-list .config-bm-row', { hasText: 'media.lab.example' }).first().click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+H');
    await page.locator('#app-modal.show .modal.bm-health-large').waitFor();
    await page.waitForTimeout(2_000);
    await shot(page, '11-health-large.jpg');
});

test('full 14 updates', async ({ page }) => {
    const { docker } = await prepare(page);
    // Three images with a newer version on offer, as an update check finds them.
    for (const name of ['radarr', 'immich-server']) {
        const c = docker.containers.find((x) => x.name === name);
        if (c) c.update = { status: 'available', checkedAt: c.update?.checkedAt || NOW.getTime() - 3 * 3_600_000 };
    }
    await openContainers(page);
    await page.locator('[data-docker-filter="updates"]').first().click();
    await page.waitForTimeout(1_000);
    await shot(page, '14-updates.jpg');
});

test('full 14 side panel', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await page.locator('[data-docker-row]', { hasText: 'sonarr' }).first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    await shot(page, '14-side-panel-full.jpg');
});

for (const [section, name] of [['appearance', '17-appearance.jpg'], ['bookmarks', '17-bookmarks.jpg'],
    ['inbox', '17-inbox.jpg'], ['containers', '17-containers.jpg'], ['help', '17-help.jpg']]) {
    test(`full 17 ${section}`, async ({ page }) => {
        await prepare(page);
        await openConfig(page, section);
        await page.waitForTimeout(1_000);
        await shot(page, name);
    });
}

test.describe('unraid config', () => {
    test.use({ dataPatch: 'unraid' });
    test('full 17 unraid', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/unraid/settings', (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            return route.fulfill({ json: { server: { id: 'u_1', name: 'tower', baseUrl: 'http://192.168.1.10', enabled: true, insecureTls: true, notify: true }, keySet: true, suggestedBaseUrl: '' } });
        });
        await page.route('**/api/unraid/area/info', (route) => route.fulfill({ json: { area: 'info', status: 'ok', data: { name: 'tower' } } }));
        await page.route('**/api/unraid/test', (route) => route.fulfill({ json: {
            ok: true, info: { name: 'tower', unraid: '7.2.1', api: '4.37.5', roles: ['VIEWER'] },
            areas: { array: 'ok', parity: 'ok', shares: 'ok', vms: 'ok', ups: 'ok', notifications: 'ok' },
        } }));
        await openConfig(page, 'unraid');
        await page.locator('[data-unraid-field="baseUrl"]').waitFor();
        await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
        await page.locator('[data-unraid-test]').click();
        await page.waitForTimeout(1_200);
        // What you get, heading and all, and the connection with the test's
        // answer below it.
        const preview = page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: 'What you get' }) }).first();
        await scrollToTop(page, preview, 60);
        await shot(page, '17-unraid.jpg');
    });
});

for (const [tab, name] of [['Usage', '18-usage.jpg'], ['Health', '18-health.jpg']]) {
    test(`full 18 ${tab.toLowerCase()}`, async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'stats');
        await subtab(page, tab).click();
        await page.waitForTimeout(2_000);
        await shot(page, name);
    });
}

test('full 19 sources', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // By its address: the tab strip repaints only the body, which would leave
    // the note under the tabs belonging to the tab before.
    await page.goto('/#config/data-backups/sources');
    await page.locator('[data-config-section]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(1_200);
    await shot(page, '19-sources.jpg');
});

test.describe('server log full', () => {
    test.use({ dataPatch: 'serverlog' });
    test('full 20 server logs', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/logs?**', (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            return route.fulfill({ json: { epoch: 'manual', entries: SERVER_LOG, nextSeq: SERVER_LOG.length, capacity: 2000, stats: { total: SERVER_LOG.length, warn: 1, error: 0 } } });
        });
        await openConfig(page, 'logs');
        await subtab(page, 'Server logs').click();
        await page.waitForTimeout(1_500);
        await shot(page, '20-server-logs-full.jpg');
    });
});

test.describe('tablet', () => {
    test.use({ viewport: TABLET, isMobile: true, hasTouch: true });
    // Parked: at 820px the header shows the clock twice (a second date pill).
    test.fixme('full 22 tablet', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        const note = page.getByRole('button', { name: 'Dismiss' }).first();
        if (await note.isVisible().catch(() => false)) await note.click();
        await page.locator('h1').first().click().catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, '22-tablet.jpg');
    });
});
