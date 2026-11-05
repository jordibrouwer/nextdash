// @ts-check
/*
 * Loops (loop.webm) for the nextdash.cc feature pages assistant, backups,
 * behavior, bookmarks-view and browser-extension. Each test sets the scene,
 * notes where the loop's first frame starts, plays one interaction at human
 * pace and cuts the page's video with trim-loop.sh.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');
const { test, prepare, settle, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'Set MANUAL_SHOTS=1 to record the site loops.');
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(300_000);

const OUT = process.env.SHOTS_OUT || '/private/tmp/claude-501/agents/loops-LA';
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/** A rest the viewer needs to take in what happened. */
// Pacing for the capture, not a condition: the viewer gets time to read the frame.
const hold = (page, ms) => page.waitForTimeout(ms);

/** Scroll in small steps, so the recording shows a scroll and not a jump. */
async function glide(page, total, steps = 10) {
    await page.mouse.move(700, 500);
    for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, total / steps);
        // Pacing for the capture, not a condition: one step of the scroll.
        await page.waitForTimeout(60);
    }
}

/** A page of its own context, which records its video. */
async function newScene(browser, baseURL) {
    const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-loop-video-'));
    const context = await browser.newContext({
        baseURL, viewport: DESKTOP, reducedMotion: 'reduce',
        recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    return { page: await context.newPage(), context };
}

/** Close the context (which finishes the video), find the video, cut the loop. */
async function finish(scene, slug, startAt, endAt) {
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    const video = scene.page.video();
    await scene.context.close();
    const src = await video.path();
    const seconds = Math.min(12.5, Math.round((endAt - startAt) * 10) / 10);
    const raw = path.join(dir, 'raw.webm');
    fs.copyFileSync(src, raw);
    // The cut itself is run by hand afterwards: libvpx at its default speed takes minutes per clip here.
    writeJSON(path.join(dir, 'loop.json'), { video: raw, startAt, seconds });
    console.log(`${slug}: startAt ${startAt} seconds ${seconds} (recorded ${endAt - startAt})`);
}

async function openConfig(page, section) {
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    await hold(page, 900);
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.locator('.config-panel, #config-db-body, [data-ai-panel]').first().waitFor();
}

/* ---------------------------------------------------------------- assistant */

function conversations(now) {
    const MIN = 60_000;
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

test.describe('assistant', () => {
    test.use({
        dataTweak: {
            run(dir) {
                const file = path.join(dir, 'settings.json');
                writeJSON(file, { ...readJSON(file), aiEnabled: true, aiProvider: 'anthropic', mcpEnabled: true, mcpHealthInbox: true, mcpContainersRead: true });
                fs.writeFileSync(path.join(dir, 'ai-secrets.json'), JSON.stringify({ keys: { anthropic: 'sk-ant-placeholder-for-screenshots' } }), { mode: 0o600 });
                fs.writeFileSync(path.join(dir, 'ai-conversations.json'), JSON.stringify(conversations(Date.now()), null, 2));
            },
        },
    });

    test('assistant loop', async ({ browser, baseURL }) => {
        const { page, context } = await newScene(browser, baseURL);
        const t0 = Date.now();
        await prepare(page);
        await openDashboard(page);
        await page.evaluate(() => { document.body.focus(); });
        await page.mouse.move(5, 895);
    const startAt = (Date.now() - t0) / 1000;
        await hold(page, 1500);
        await page.keyboard.press('=');
        await page.getByText('Tag everything about Proxmox').first().waitFor({ timeout: 10_000 });
        await hold(page, 1800);
        await page.keyboard.press('Enter');
        const panel = page.locator('.assistant-panel');
        await panel.waitFor();
        await hold(page, 1200);
        await panel.getByRole('button', { name: /^Which of my links are down\?/ }).click();
        await panel.locator('[data-ai-thread]').getByText('Three bookmarks failed').waitFor();
        await hold(page, 2600);
        await page.keyboard.press('Escape');
        await page.locator('.assistant-panel').waitFor({ state: 'hidden', timeout: 5_000 });
        await page.mouse.move(5, 895);
        await hold(page, 1200);
        const endAt = (Date.now() - t0) / 1000;
        await finish({ page, context }, 'assistant', startAt, endAt);
    });
});

/* ------------------------------------------------------------------ backups */

test.describe('backups', () => {
    test.use({
        dataTweak: {
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
        },
    });

    test('backups loop', async ({ browser, baseURL }) => {
        const { page, context } = await newScene(browser, baseURL);
        const t0 = Date.now();
        await prepare(page);
        await openDashboard(page);
        await page.mouse.move(5, 895);
    const startAt = (Date.now() - t0) / 1000;
        await hold(page, 1200);
        await openConfig(page, 'data-backups');
        await page.locator('[data-db-status]').waitFor();
        await hold(page, 800);
        await subtab(page, 'Backups').click();
        await hold(page, 2000);
        await page.evaluate(() => {
            for (const p of document.querySelectorAll('#config-db-body p')) {
                if (/^Stored in /.test(p.textContent || '')) p.textContent = 'Stored in /data/auto-backups.';
                else if (/inside the data directory/.test(p.textContent || '')) p.remove();
            }
        });
        await glide(page, 640);
        await hold(page, 2200);
        await glide(page, -640);
        await hold(page, 800);
        await page.keyboard.press('Escape');
        await page.locator('.category').first().waitFor({ state: 'visible' });
        await page.mouse.move(5, 895);
        await hold(page, 2000);
        const endAt = (Date.now() - t0) / 1000;
        await finish({ page, context }, 'backups', startAt, endAt);
    });
});

/* ----------------------------------------------------------------- behavior */

test('behavior loop', async ({ browser, baseURL }) => {
    const { page, context } = await newScene(browser, baseURL);
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page);
    await page.mouse.move(5, 895);
    const startAt = (Date.now() - t0) / 1000;
    await hold(page, 1200);
    await openConfig(page, 'behavior');
    await page.locator('[data-behavior-tab="general"]').first().click();
    await hold(page, 1500);
    const lock = page.locator('label, .config-field, .config-row', { hasText: /^\s*Lock layout/ }).first();
    await lock.scrollIntoViewIfNeeded();
    await lock.locator('input[type="checkbox"], .config-switch, .switch').first().click();
    await hold(page, 1500);
    await lock.locator('input[type="checkbox"], .config-switch, .switch').first().click();
    await hold(page, 800);
    await page.locator('[data-behavior-tab="search"]').first().click();
    await hold(page, 2000);
    await page.locator('[data-behavior-tab="privacy"]').first().click();
    await hold(page, 1800);
    await page.keyboard.press('Escape');
    await page.locator('.category').first().waitFor({ state: 'visible' });
    await page.mouse.move(5, 895);
    await hold(page, 1300);
    const endAt = (Date.now() - t0) / 1000;
    await finish({ page, context }, 'behavior', startAt, endAt);
});

/* ------------------------------------------------------------ bookmarks view */

test('bookmarks view loop', async ({ browser, baseURL }) => {
    const { page, context } = await newScene(browser, baseURL);
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => { document.body.focus(); });
    await page.mouse.move(5, 895);
    const startAt = (Date.now() - t0) / 1000;
    await hold(page, 900);
    await page.keyboard.press('Shift+B');
    const rows = page.locator('#config-bm-list .config-bm-row');
    await rows.first().waitFor();
    await hold(page, 900);
    await page.keyboard.press('j');
    await hold(page, 300);
    await page.keyboard.press('j');
    await hold(page, 300);
    await page.keyboard.press('i');
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await hold(page, 800);
    await page.keyboard.press('2');
    await hold(page, 700);
    await page.keyboard.press('3');
    await hold(page, 700);
    await page.keyboard.press('1');
    await hold(page, 400);
    await page.keyboard.press('x');
    await hold(page, 300);
    await page.keyboard.press('j');
    await hold(page, 300);
    await page.keyboard.press('x');
    await hold(page, 1000);
    await page.getByRole('button', { name: /Clear selection/ }).first().click();
    await hold(page, 400);
    await page.getByRole('link', { name: 'dashboard' }).first().click();
    await page.locator('.category').first().waitFor({ state: 'visible' });
    await page.mouse.move(5, 895);
    await hold(page, 1200);
    const endAt = (Date.now() - t0) / 1000;
    await finish({ page, context }, 'bookmarks-view', startAt, endAt);
});

/* ---------------------------------------------------------- browser extension */

const EXTENSION = path.join(__dirname, '..', 'extension');

test.describe('browser extension', () => {
    test.use({ dataTweak: { run(dir) { const f = path.join(dir, 'settings.json'); writeJSON(f, { ...readJSON(f), enableSessionTips: false }); } } });

    test('extension loop', async ({ browser, baseURL }) => {
        const { page, context: dashContext } = await newScene(browser, baseURL);
        await prepare(page);
        await openDashboard(page);
        await settle(page);
        const backdropPng = (await page.screenshot({ type: 'jpeg', quality: 82 })).toString('base64');
        const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-loop-ext-video-'));
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-loop-extension-'));
        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            viewport: { width: 1440, height: 900 },
            recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
            args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
        });
        try {
            let worker = context.serviceWorkers()[0];
            if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
            const extensionId = worker.url().split('/')[2];
            const popup = await context.newPage();
            const t0 = Date.now();
            // Paint the dashboard behind the popup from the first frame.
            await popup.addInitScript((png) => {
                const style = document.createElement('style');
                style.textContent = `
                    html { min-height: 100vh; background: url(data:image/jpeg;base64,${png}) 0 0 / 100% 100% no-repeat; }
                    body { position: absolute; top: 56px; right: 40px; margin: 0; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
                    .save-success-panel.hidden, .save-form.hidden { display: none !important; }`;
                document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
            }, backdropPng);
            await popup.goto(`chrome-extension://${extensionId}/popup.html`);
            await popup.locator('#save-tab').waitFor({ state: 'visible' });
            await popup.locator('.tab-button[data-tab="settings"]').click();
            await popup.locator('#server-url').fill(baseURL);
            await popup.locator('#reload-pages-btn').click();
            await popup.locator('#default-page option').first().waitFor({ state: 'attached', timeout: 15_000 });
            await popup.locator('#settings-form button[type="submit"]').click();
            await popup.locator('.message.success').waitFor({ state: 'visible', timeout: 15_000 });
            await context.route('**/api/bookmark-preview**', (route) => route.fulfill({ json: {
                title: 'First steps with a small server', description: 'A short guide to running your first service at home.',
                image: '', icon: '', iconSource: '', domain: 'docs.example.org', setIcon: false,
            } }));
            await popup.locator('.tab-button[data-tab="save"]').click();
            await popup.locator('#page-select option').first().waitFor({ state: 'attached', timeout: 15_000 });
            // The popup's script shows the duplicate warning only through its hidden attribute, but the markup
            // also carries the class .hidden, which popup.css now enforces: the warning never shows (app bug).
            // The loop shows the popup with the class taken off, so the attribute alone decides.
            await popup.evaluate(() => document.getElementById('bookmark-url-duplicate-panel').classList.remove('hidden'));
            await popup.locator('#page-select').selectOption({ index: 0 });
            await popup.locator('#bookmark-url').fill('https://docs.example.org/guides/first-steps');
            await popup.locator('#bookmark-name').fill('First steps with a small server');
            await popup.locator('#ext-preview-strip-section:not([hidden])').waitFor({ timeout: 15_000 });
            await popup.evaluate(() => document.activeElement?.blur?.());
            await popup.mouse.move(5, 895);
            const startAt = (Date.now() - t0) / 1000;
            await hold(popup, 1800);
            await popup.locator('.tab-button[data-tab="settings"]').click();
            // The test server's port is random; the loop shows the address of a home server.
            await popup.locator('#server-url').evaluate((el) => { /** @type {HTMLInputElement} */ (el).value = 'http://nextdash.lan:8080'; });
            await popup.mouse.move(5, 895);
            await hold(popup, 2300);
            await popup.locator('.tab-button[data-tab="save"]').click();
            await popup.mouse.move(5, 895);
            await hold(popup, 1200);
            // Coming back from Settings reloads the page list; choosing the page again refreshes the duplicate check.
            await popup.locator('#page-select').selectOption({ index: 0 });
            await popup.locator('#bookmark-url').fill('https://go.dev/doc/');
            await popup.evaluate(() => document.activeElement?.blur?.());
            await popup.locator('#bookmark-url-duplicate-panel').waitFor({ state: 'visible', timeout: 15_000 });
            await hold(popup, 2500);
            await popup.locator('#bookmark-url').fill('https://docs.example.org/guides/first-steps');
            await popup.locator('#bookmark-url-duplicate-panel').waitFor({ state: 'hidden', timeout: 15_000 });
            await popup.locator('#ext-preview-strip-section:not([hidden])').waitFor({ timeout: 15_000 });
            await popup.evaluate(() => document.activeElement?.blur?.());
            await hold(popup, 1500);
            const endAt = (Date.now() - t0) / 1000;
            await finish({ page: popup, context }, 'browser-extension', startAt, endAt);
        } finally {
            await dashContext.close();
            await context.close().catch(() => {});
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
    });
});
