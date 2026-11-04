// @ts-check
/*
 * nextdash.cc feature-page pictures, set A: assistant, backups, behavior,
 * bookmarks-view, browser-extension. Full 1440x900 frames in the kit's default
 * theme, over the demo seed.
 */
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { test, prepare, settle, shot, openDashboard, DESKTOP, NOW } = require('./helpers/manual-shot-kit');
const NOW_MS = () => NOW.getTime();

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const MIN = 60_000;
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** Let a toast that is on its way come and go. */
async function waitOutNotice(page) {
    const toast = page.locator('#app-notification.show');
    await toast.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: the section finishes drawing.
    await page.waitForTimeout(800);
    await settle(page);
}
const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/** Scroll so an element stands near the top of the window. */
async function scrollToTop(page, locator, offset = 140) {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, box.y - offset);
    // Pacing for the capture, not a condition: the scroll comes to rest.
    await page.waitForTimeout(500);
}

/* ---------------------------------------------------------------- assistant */

function conversations(now) {
    const answer = (id, text, extra = {}) => ({
        id, role: 'assistant', text, tools: [], proposals: [], provider: 'anthropic', model: 'claude-sonnet-5-5',
        tokensIn: 5200, tokensOut: 310, created: now, ...extra,
    });
    const question = (id, text, created) => ({ id, role: 'user', text, tools: [], proposals: [], provider: '', model: '', tokensIn: 0, tokensOut: 0, created });
    return [
        {
            id: 'c-down', title: 'Which of my links are down?', created: now - 12 * MIN, updated: now - 11 * MIN,
            messages: [
                question('m1', 'Which of my links are down? Tidy up what is dead.', now - 12 * MIN),
                answer('m2',
                    'Three bookmarks failed their last check:\n\n' +
                    '- **Podcast feed** (podcast.example.net): DNS lookup failed, down for 3 days\n' +
                    '- **Homelab wiki** (wiki.example.org): HTTP 404 since the same day\n' +
                    '- **Shodan** (shodan.io): HTTP 502, probably a hiccup on their side\n\n' +
                    'The first two look gone for good. I would tag Shodan and keep it, and move the other two out of sight.',
                    {
                        created: now - 11 * MIN,
                        tools: [{ name: 'list_health_issues', bytes: 1480 }, { name: 'search_bookmarks', bytes: 2210 }],
                        proposals: [
                            { id: 'p1', tool: 'update_bookmark', status: 'pending', destructive: false, error: '', result: '', arguments: { url: 'https://www.shodan.io/', tags_add: ['check-later'] }, reason: 'The 502 may pass; tagged so it comes back in a search.' },
                            { id: 'p2', tool: 'delete_bookmark', status: 'pending', destructive: true, error: '', result: '', arguments: { url: 'https://podcast.example.net/feed' }, reason: 'The domain no longer resolves. It goes to the Trash, where you can restore it.' },
                        ],
                    }),
            ],
        },
        {
            id: 'c-tags', title: 'Tag everything about Proxmox', created: now - 3 * 86_400_000, updated: now - 3 * 86_400_000,
            messages: [
                question('m3', 'Tag everything about Proxmox', now - 3 * 86_400_000),
                answer('m4', 'Done: four bookmarks now carry the tag proxmox.', { created: now - 3 * 86_400_000, tools: [{ name: 'search_bookmarks', bytes: 1900 }] }),
            ],
        },
        {
            id: 'c-inbox', title: 'What is waiting in my Inbox?', created: now - 6 * 86_400_000, updated: now - 6 * 86_400_000,
            messages: [
                question('m5', 'What is waiting in my Inbox?', now - 6 * 86_400_000),
                answer('m6', 'Nine unread links, the oldest from three weeks ago.', { created: now - 6 * 86_400_000, tools: [{ name: 'list_inbox', bytes: 3100 }] }),
            ],
        },
    ];
}

const withAssistant = {
    run(dir) {
        const file = path.join(dir, 'settings.json');
        Object.assign(readJSON(file), {});
        writeJSON(file, { ...readJSON(file), aiEnabled: true, aiProvider: 'anthropic', mcpEnabled: true, mcpHealthInbox: true, mcpContainersRead: true });
        fs.writeFileSync(path.join(dir, 'ai-secrets.json'), JSON.stringify({ keys: { anthropic: 'sk-ant-placeholder-for-screenshots' } }), { mode: 0o600 });
        fs.writeFileSync(path.join(dir, 'ai-conversations.json'), JSON.stringify(conversations(Date.now()), null, 2));
    },
};

test.describe('assistant', () => {
    test.use({ dataTweak: withAssistant });

    test('assistant panel with proposals', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.evaluate(() => { document.body.focus(); });
        await page.keyboard.press('=');
        await page.keyboard.press('Enter');
        const panel = page.locator('.assistant-panel');
        await panel.waitFor();
        await panel.getByRole('button', { name: /^Which of my links are down\?/ }).click();
        await panel.locator('[data-ai-thread]').getByText('Three bookmarks failed').waitFor();
        // Pacing for the capture, not a condition: the panel finishes sliding in.
        await page.waitForTimeout(800);
        await shot(page, 'assistant/shot-1.jpg');
    });

    test('assistant search bar conversations', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.evaluate(() => { document.body.focus(); });
        await page.keyboard.press('=');
        // Pacing for the capture, not a condition: the list of conversations finishes drawing.
        await page.waitForTimeout(800);
        await shot(page, 'assistant/shot-4.jpg');
    });

    test('assistant config', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'assistant');
        await page.locator('[data-ai-panel]').waitFor();
        // The four panels together are taller than the window: scroll to the end of the page,
        // so Conversations and What it can see and do are whole and the Provider panel ends above them.
        await page.mouse.move(700, 500);
        await page.mouse.wheel(0, 2000);
        // Pacing for the capture, not a condition: the scroll comes to rest.
        await page.waitForTimeout(700);
        await shot(page, 'assistant/shot-2.jpg');
    });

    test('mcp access', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'data-backups');
        await page.locator('[data-db-tab="webhooks"]').click();
        const panel = page.locator('[data-fold="mcp"]');
        await panel.waitFor();
        if (!(await panel.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open))) await panel.locator('summary').click();
        await panel.locator('.config-mcp-address').evaluate((el) => { el.textContent = 'http://your-host:8080/mcp'; });
        await scrollToTop(page, panel, 150);
        await shot(page, 'assistant/shot-3.jpg');
    });
});

/* ------------------------------------------------------------------ backups */

/** Two older backups beside the one the seed holds, so the list has three. */
const threeBackups = {
    run(dir) {
        const folder = path.join(dir, 'auto-backups');
        const [first] = fs.readdirSync(folder).filter((f) => f.endsWith('.zip'));
        const newest = fs.statSync(path.join(folder, first)).mtime;
        for (const [days, name] of [[1, 'nextdash-auto-backup-2026-11-03T211717Z.zip'], [2, 'nextdash-auto-backup-2026-11-02T211717Z.zip']]) {
            const target = path.join(folder, name);
            fs.copyFileSync(path.join(folder, first), target);
            const when = new Date(newest.getTime() - days * 86_400_000);
            fs.utimesSync(target, when, when);
        }
    },
};

test.describe('backups', () => {
    test.use({ dataTweak: threeBackups });

    test('backups status', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'data-backups');
        await subtab(page, 'Backups').click();
        await page.locator('[data-db-status]').waitFor();
        // Pacing for the capture, not a condition: the backup list finishes loading.
        await page.waitForTimeout(1_200);
        await shot(page, 'backups/shot-1.jpg');
    });

    test('backups list and move group', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'data-backups');
        await subtab(page, 'Backups').click();
        await page.locator('[data-db-status]').waitFor();
        // Pacing for the capture, not a condition: the backup list finishes loading.
        await page.waitForTimeout(1_200);
        // The test server keeps its data in a temp folder; a Docker install shows /data/auto-backups
        // and no warning about the folder.
        await page.evaluate(() => {
            for (const p of document.querySelectorAll('#config-db-body p')) {
                if (/^Stored in /.test(p.textContent || '')) p.textContent = 'Stored in /data/auto-backups.';
                else if (/inside the data directory/.test(p.textContent || '')) p.remove();
            }
        });
        await page.mouse.move(700, 500);
        await page.mouse.wheel(0, 640);
        // Pacing for the capture, not a condition: the scroll comes to rest.
        await page.waitForTimeout(600);
        await shot(page, 'backups/shot-2.jpg');
    });
});

/** Twelve links in two folders, two of them already on the dashboard. */
const IMPORT_FILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><A HREF="https://slowweb.example.org/essays/small-software" ADD_DATE="1760000000">Essays on small software</A>
    <DT><A HREF="https://pagetwo.example.com/notes/queues" ADD_DATE="1760100000">Notes on queues</A>
    <DT><A HREF="https://longform.example.net/the-quiet-server" ADD_DATE="1760200000">The quiet server</A>
    <DT><A HREF="https://blog.example.dev/rack-diary" ADD_DATE="1760300000">A rack diary</A>
    <DT><A HREF="https://weeknotes.example.io/2026/41" ADD_DATE="1760400000">Weeknotes 41</A>
    <DT><A HREF="https://go.dev/doc/" ADD_DATE="1760500000">Go documentation</A>
  </DL><p>
  <DT><H3>Tools</H3>
  <DL><p>
    <DT><A HREF="https://toolbox.example.org/diff" ADD_DATE="1760600000">Text diff</A>
    <DT><A HREF="https://paste.example.com/" ADD_DATE="1760700000">Paste bin</A>
    <DT><A HREF="https://convert.example.net/units" ADD_DATE="1760800000">Unit converter</A>
    <DT><A HREF="https://sketchpad.example.dev/" ADD_DATE="1760900000">Sketchpad</A>
    <DT><A HREF="https://devdocs.io/" ADD_DATE="1761000000">DevDocs</A>
    <DT><A HREF="https://timers.example.io/cron" ADD_DATE="1761100000">Cron helper</A>
  </DL><p>
</DL><p>`;

async function chooseImportFile(page) {
    await openConfig(page, 'data-backups');
    await subtab(page, 'Backups').click();
    await page.locator('#config-browser-import-input').waitFor({ state: 'attached' });
    await page.setInputFiles('#config-browser-import-input', { name: 'bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(IMPORT_FILE) });
    const dialog = page.locator('#config-confirm-modal.show');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.locator('[data-import-dest]').first().waitFor();
    return dialog;
}

test('import dialog', async ({ page }) => {
    await prepare(page);
    const dialog = await chooseImportFile(page);
    await expect(dialog).toContainText('12');
    // Pacing for the capture, not a condition: the dialog finishes fading in.
    await page.waitForTimeout(800);
    await shot(page, 'backups/shot-4.jpg');
});

test('inbox after an import', async ({ page }) => {
    await prepare(page);
    const dialog = await chooseImportFile(page);
    await dialog.locator('[data-import-dest="page"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.locator('[data-import-dest="inbox"]')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    await expect.poll(async () => page.evaluate(async () => {
        const { items } = await (await fetch('/api/inbox')).json();
        return (items || []).filter((i) => /example\.(org|com|net|dev|io)/.test(i.url) && /slowweb|pagetwo|toolbox/.test(i.url)).length;
    }), { timeout: 15_000 }).toBe(3);
    await waitOutNotice(page);
    await page.locator('#page-nav-inbox-btn').click();
    await page.locator('.inbox-layout').waitFor();
    await settle(page);
    await page.locator('.inbox-layout').getByText('Essays on small software').first().waitFor();
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
    await shot(page, 'backups/shot-5.jpg');
});

/** Four bookmarks of the page the view opens on, deleted the ordinary way. */
test('trash with four items', async ({ page }) => {
    await prepare(page);
    // The server stamps a deletion with its own time; the shots' clock stands a little earlier.
    await page.route('**/api/trash', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = await response.json();
        (body.items || []).forEach((item, i) => { item.deletedAt = NOW_MS() - (i + 1) * 55 * 60_000; });
        return route.fulfill({ response, json: body });
    });
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    for (const host of ['devdocs.io', 'jwt.io', 'regex101.com', 'crontab.guru']) {
        await page.locator('#config-bm-list .config-bm-row', { hasText: host }).first().click();
        await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.keyboard.press('d');
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await page.locator('#config-bm-list .config-bm-row', { hasText: host }).first().waitFor({ state: 'detached' });
    }
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="data-backups"]').click();
    await subtab(page, 'Trash').click();
    await waitOutNotice(page);
    await page.getByText('Bookmark deleted').first().waitFor({ state: 'hidden', timeout: 20_000 });
    await page.locator('[data-trash-id], [data-trash-select]').first().waitFor();
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
    await shot(page, 'backups/shot-3.jpg');
});

/* ----------------------------------------------------------------- behavior */

const panelTitled = (page, title) => page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: title }) }).first();

async function openBehavior(page, tab) {
    await openConfig(page, 'behavior');
    if (tab) {
        await page.locator(`[data-behavior-tab="${tab}"]`).first().click();
        // Pacing for the capture, not a condition: the tab's panels finish drawing.
        await page.waitForTimeout(700);
    }
}

test.describe('behavior', () => {
    test('behavior general', async ({ page }) => {
        await prepare(page);
        await openBehavior(page, 'general');
        await shot(page, 'behavior/shot-1.jpg');
    });

    test('behavior general scrolled', async ({ page }) => {
        await prepare(page);
        await openBehavior(page, 'general');
        await scrollToTop(page, panelTitled(page, /^Opening links/), 90);
        await shot(page, 'behavior/shot-2.jpg');
    });

    test('behavior keyboard and search', async ({ page }) => {
        await prepare(page);
        await openBehavior(page, 'search');
        await shot(page, 'behavior/shot-3.jpg');
    });

    test('behavior keyboard and search scrolled', async ({ page }) => {
        await prepare(page);
        await openBehavior(page, 'search');
        await scrollToTop(page, panelTitled(page, /^Suggestions/), 90);
        await shot(page, 'behavior/shot-4.jpg');
    });

    test('behavior privacy and sync', async ({ page }) => {
        await prepare(page);
        await openBehavior(page, 'privacy');
        await scrollToTop(page, panelTitled(page, /^Privacy$/), 90);
        await shot(page, 'behavior/shot-5.jpg');
    });
});

/* ---------------------------------------------------------- browser extension */

const { chromium } = require('@playwright/test');
const os = require('os');

const EXTENSION = path.join(__dirname, '..', 'extension');

/**
 * The popup of the unpacked extension, pointed at this test's server, drawn at
 * the top right of the dashboard: the popup is 350px wide, so on its own it is
 * a narrow strip in a 1440x900 frame. The dashboard behind it is a screenshot
 * of the same server, set as the backdrop of the popup's own page.
 */
async function openPopup(page, baseURL, { backdrop = true } = {}) {
    await prepare(page);
    await openDashboard(page);
    await settle(page);
    const backdropPng = backdrop ? (await page.screenshot({ type: 'jpeg', quality: 82 })).toString('base64') : '';
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-site-extension-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1440, height: 900 },
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = worker.url().split('/')[2];
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#save-tab').waitFor({ state: 'visible' });
    // Settings first, the way a user sets it up: the address, then the pages load.
    await popup.locator('.tab-button[data-tab="settings"]').click();
    await popup.locator('#server-url').fill(baseURL);
    await popup.locator('#reload-pages-btn').click();
    await popup.locator('#default-page option').first().waitFor({ state: 'attached', timeout: 15_000 });
    await popup.locator('#settings-form button[type="submit"]').click();
    await popup.locator('.message.success').waitFor({ state: 'visible', timeout: 15_000 });
    const cleanup = async () => {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    };
    const dress = () => popup.evaluate((png) => {
        const style = document.createElement('style');
        style.textContent = `
            html { min-height: 100vh; background: ${png ? `url(data:image/jpeg;base64,${png}) 0 0 / 100% 100% no-repeat` : 'transparent'}; }
            body { position: absolute; top: 56px; right: 40px; margin: 0; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
            /* popup.css lost the head of its .save-success-panel rule, which swallowed the .hidden
               rule after it; the picture shows the popup with that rule working. */
            .save-success-panel.hidden, .save-form.hidden, .hidden { display: none !important; }`;
        document.head.appendChild(style);
    }, backdropPng);
    return { popup, context, dress, cleanup };
}

async function popupShot(popup, name) {
    fs.mkdirSync(path.dirname(path.join(process.env.SHOTS_OUT || '', name)), { recursive: true });
    await popup.mouse.move(5, 895);
    await popup.evaluate(() => document.activeElement?.blur?.());
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(process.env.SHOTS_OUT || '', name), type: 'jpeg', quality: 82 });
}

test.describe('browser extension', () => {
    test.setTimeout(150_000);
    // No keyboard tip over the dashboard behind the popup.
    test.use({ dataTweak: { run(dir) { const f = path.join(dir, 'settings.json'); writeJSON(f, { ...readJSON(f), enableSessionTips: false }); } } });

    test('popup save tab', async ({ page, baseURL }) => {
        const { popup, context, dress, cleanup } = await openPopup(page, baseURL);
        try {
            await context.route('**/api/bookmark-preview**', (route) => route.fulfill({ json: {
                title: 'First steps with a small server', description: 'A short guide to running your first service at home.',
                image: '', icon: '', iconSource: '', domain: 'docs.example.org', setIcon: false,
            } }));
            await popup.locator('.tab-button[data-tab="save"]').click();
            await popup.locator('#page-select option').first().waitFor({ state: 'attached', timeout: 15_000 });
            await popup.locator('#bookmark-url').fill('https://docs.example.org/guides/first-steps');
            await popup.locator('#bookmark-name').fill('First steps with a small server');
            await popup.locator('#ext-preview-strip-section:not([hidden])').waitFor({ timeout: 15_000 });
            await dress();
            await popupShot(popup, 'browser-extension/shot-1.jpg');
        } finally {
            await cleanup();
        }
    });

    test('popup duplicate warning', async ({ page, baseURL }) => {
        const { popup, cleanup, dress } = await openPopup(page, baseURL);
        try {
            await popup.locator('.tab-button[data-tab="save"]').click();
            await popup.locator('#page-select option').first().waitFor({ state: 'attached', timeout: 15_000 });
            await popup.locator('#page-select').selectOption({ index: 0 });
            await popup.locator('#bookmark-url').fill('https://go.dev/doc/');
            await popup.locator('#bookmark-name').fill('Go documentation');
            await popup.locator('#bookmark-url-duplicate-panel').waitFor({ state: 'visible', timeout: 15_000 });
            await dress();
            await popupShot(popup, 'browser-extension/shot-2.jpg');
        } finally {
            await cleanup();
        }
    });

    test('popup settings tab', async ({ page, baseURL }) => {
        const { popup, cleanup, dress } = await openPopup(page, baseURL);
        try {
            await popup.locator('.tab-button[data-tab="settings"]').click();
            await popup.locator('#default-page').selectOption({ index: 0 });
            await expect.poll(() => popup.locator('#default-category option').count(), { timeout: 10_000 }).toBeGreaterThan(1);
            // The test server's port is random; the picture shows the address of a home server.
            await popup.locator('#server-url').evaluate((el) => { /** @type {HTMLInputElement} */ (el).value = 'http://nextdash.lan:8080'; });
            await dress();
            await popupShot(popup, 'browser-extension/shot-3.jpg');
        } finally {
            await cleanup();
        }
    });
});

/* ------------------------------------------------------------ bookmarks view */

async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
}

test.describe('bookmarks view', () => {
    test('view with the side panel', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-list .config-bm-row', { hasText: 'github.com' }).first().click();
        await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
        await page.mouse.move(700, 400);
        await page.mouse.wheel(0, -3000);
        // Pacing for the capture, not a condition: the panel finishes sliding in.
        await page.waitForTimeout(1_000);
        await shot(page, 'bookmarks-view/shot-1.jpg');
    });

    test('three ticked and the selection bar', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        const rows = page.locator('#config-bm-list .config-bm-row');
        for (let i = 0; i < 3; i += 1) {
            // The tick shows when the pointer is over the row.
            await rows.nth(i).hover();
            await rows.nth(i).locator('.config-bm-tick').check();
        }
        await page.getByRole('button', { name: /Clear selection/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
        // Pacing for the capture, not a condition: the bar finishes sliding in.
        await page.waitForTimeout(800);
        await shot(page, 'bookmarks-view/shot-2.jpg');
    });

    test('work through chooser', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('f');
        await page.locator('[data-focus-chooser]').waitFor();
        // Pacing for the capture, not a condition: the chooser finishes fading in.
        await page.waitForTimeout(800);
        await shot(page, 'bookmarks-view/shot-3.jpg');
    });

    test('work through one card', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('f');
        await page.locator('[data-focus-chooser]').waitFor();
        await page.locator('.health-focus-pile', { hasText: 'Broken links' }).click();
        const card = page.locator('.health-focus-overlay .health-focus-card').first();
        await card.getByText('Old homelab wiki').first().waitFor();
        // Pacing for the capture, not a condition: the card finishes drawing.
        await page.waitForTimeout(800);
        await shot(page, 'bookmarks-view/shot-4.jpg');
    });

    test('pages and categories window', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-rail [data-bm-manage="categories"]').click();
        const structure = page.locator('.modal.config-structure-modal');
        await structure.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the window finishes drawing.
        await page.waitForTimeout(1_000);
        await shot(page, 'bookmarks-view/shot-5.jpg');
    });
});
