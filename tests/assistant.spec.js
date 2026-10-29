// @ts-check
const http = require('http');
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * `:ask` and the assistant panel, against a stub OpenAI-compatible server the
 * spec starts itself. The stub answers the first request of a turn with a
 * propose_changes call and, once the tool result comes back, with streamed
 * text and the token usage.
 */
const AUTH = { 'X-NextDash-Token': WRITE_TOKEN };
const BOOKMARK_URL = 'https://assistant-spec.example/notes';
const NEW_NOTE = 'Checked by the assistant';

/** @type {import('http').Server} */
let server;
let baseURL = '';
let requests = 0;

function sse(res, chunks) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

function proposal(args, reason) {
    return { tool: 'update_bookmark', arguments: args, reason };
}

const EVIL = '<img src=x onerror="window.__xss=1">';

/** 'one' change; 'two' adds a second; 'three' also a deletion; 'evil' puts markup in the answer and an argument. */
let mode = 'one';

function proposedChanges() {
    const note = mode === 'evil' ? EVIL : NEW_NOTE;
    const changes = [proposal({ url: BOOKMARK_URL, note }, 'The note was empty.')];
    if (mode === 'two' || mode === 'three') {
        changes.push(proposal({ url: BOOKMARK_URL, name: 'Assistant spec renamed' }, 'The name was vague.'));
    }
    if (mode === 'three') {
        changes.push({ tool: 'delete_bookmark', arguments: { url: BOOKMARK_URL }, reason: 'It is a duplicate.' });
    }
    return changes;
}

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            requests += 1;
            if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
                res.writeHead(404).end();
                return;
            }
            let body = {};
            try { body = JSON.parse(raw); } catch { /* an empty body answers as the first request */ }
            const hasToolResult = (body.messages || []).some((m) => m.role === 'tool');
            if (!hasToolResult) {
                sse(res, [
                    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'propose_changes', arguments: JSON.stringify({ changes: proposedChanges() }) } }] } }] },
                    { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } },
                ]);
                return;
            }
            sse(res, [
                { choices: [{ delta: { content: mode === 'evil' ? EVIL : 'Two containers' } }] },
                { choices: [{ delta: { content: mode === 'evil' ? '' : ' need an update.' } }] },
                { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 240 } },
            ]);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`;
});

test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

// A compatible server needs no key, so the spec never stores one.
async function configure(page, enabled) {
    const s = await (await page.request.get('/api/settings')).json();
    Object.assign(s, {
        aiEnabled: enabled, aiProvider: 'compatible', aiBaseURL: baseURL, aiModel: 'stub-model', mcpBookmarksWrite: true,
    });
    expect((await page.request.post('/api/settings', { data: s, headers: AUTH })).ok()).toBe(true);
}

async function removeBookmark(page) {
    const list = await (await page.request.get('/api/bookmarks?page=1')).json();
    const bookmark = list.find((b) => b.url === BOOKMARK_URL);
    if (bookmark) await page.request.delete('/api/bookmarks', { data: { page: 1, bookmark }, headers: AUTH });
}

async function seedBookmark(page) {
    await removeBookmark(page);
    const res = await page.request.post('/api/bookmarks/add', {
        data: { page: 1, bookmark: { name: 'Assistant spec', url: BOOKMARK_URL, category: '' } },
        headers: AUTH,
    });
    expect(res.ok()).toBe(true);
}

async function openApp(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function palette(page, text) {
    await page.evaluate(() => { document.body.focus(); });
    await page.keyboard.press(':');
    await page.keyboard.type(text);
}

const panel = (page) => page.locator('.assistant-panel');

async function askFromPalette(page) {
    await palette(page, 'ask which containers need an update');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('[data-ai-thread]')).toContainText('Two containers need an update.');
}

test.describe('Assistant panel', () => {
    test.describe.configure({ mode: 'serial' });

    /** What the data folder held before the spec touched it, put back afterwards. */
    let priorSettings = null;
    let priorConversations = new Set();

    test.beforeEach(async ({ page }) => {
        requests = 0;
        mode = 'one';
        priorSettings = await (await page.request.get('/api/settings')).json();
        priorConversations = new Set((await (await page.request.get('/api/ai/conversations')).json()).map((c) => c.id));
        await seedBookmark(page);
        await configure(page, true);
        await openApp(page);
    });

    test.afterEach(async ({ page }) => {
        if (priorSettings) await page.request.post('/api/settings', { data: priorSettings, headers: AUTH });
        // Only the conversations this spec made.
        const now = await (await page.request.get('/api/ai/conversations')).json();
        for (const c of now) {
            if (!priorConversations.has(c.id)) await page.request.delete(`/api/ai/conversations/${c.id}`, { headers: AUTH });
        }
        await removeBookmark(page);
    });

    test(':ask opens the panel, streams the answer and shows the token line', async ({ page }) => {
        await askFromPalette(page);
        await expect(panel(page).locator('.assistant-meta')).toHaveText(/^OpenAI-compatible · stub-model · 1[.,]240 tokens$/);
        await expect(panel(page).locator('[data-ai-input]')).toBeFocused();
    });

    test('the question never lands in the palette recents', async ({ page }) => {
        const tracked = [];
        page.on('request', (r) => { if (r.url().includes('/api/track-search')) tracked.push(r.postData() || ''); });
        await askFromPalette(page);
        const stored = await page.evaluate(() => JSON.stringify([
            localStorage.getItem('dashboardRecentCommands'), localStorage.getItem('dashboardSearchHistory'),
        ]));
        expect(stored).toContain(':ask');
        expect(stored).not.toContain('containers');
        expect(tracked.join('')).not.toContain('containers');
    });

    test('a proposal card applies and the bookmark changes', async ({ page }) => {
        await askFromPalette(page);
        const card = panel(page).locator('[data-ai-proposal]');
        await expect(card).toContainText('Change a bookmark');
        await expect(card).toContainText(NEW_NOTE);
        await card.locator('[data-ai-apply]').click();
        await expect(card).toContainText('Done');
        await expect(card.locator('[data-ai-apply]')).toHaveCount(0);
        await expect.poll(async () => {
            const list = await (await page.request.get('/api/bookmarks?page=1')).json();
            return list.find((b) => b.url === BOOKMARK_URL)?.note;
        }).toBe(NEW_NOTE);
    });

    test('after Apply the dashboard behind the panel shows the change without a reload', async ({ page }) => {
        mode = 'two';
        await askFromPalette(page);
        await panel(page).locator('[data-ai-apply-all]').click();
        await expect(panel(page).locator('[data-ai-proposal]').first()).toContainText('Done');
        await panel(page).locator('[data-ai-close]').first().click();
        await expect(panel(page)).toBeHidden();
        await expect(page.locator('#dashboard-layout').getByText('Assistant spec renamed').first()).toBeVisible({ timeout: 10_000 });
    });

    test('after a reload the conversation is in the sidebar and opens with its card', async ({ page }) => {
        await askFromPalette(page);
        await panel(page).locator('[data-ai-proposal] [data-ai-apply]').click();
        await expect(panel(page).locator('[data-ai-proposal]')).toContainText('Done');

        await openApp(page);
        await palette(page, 'ask');
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        const conv = panel(page).locator('[data-ai-conv]', { hasText: 'which containers need an update' });
        await expect(conv).toHaveCount(1);
        await conv.locator('[data-ai-open]').click();
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('Two containers need an update.');
        await expect(panel(page).locator('[data-ai-proposal]')).toContainText('Done');
        expect(requests).toBe(2);
    });

    test('with the assistant off the palette says so and opens the Config fold', async ({ page }) => {
        await configure(page, false);
        await openApp(page);
        await palette(page, 'ask what is new');
        await expect(page.locator('#shortcut-search')).toContainText('The assistant is off. Set it up in Config');
        await page.keyboard.press('Enter');
        const fold = page.locator('[data-fold="assistant"]');
        await expect(fold).toBeVisible();
        await expect(fold).toHaveAttribute('open', '');
        await expect(panel(page)).toHaveCount(0);
        expect(requests).toBe(0);
    });

    test('Escape closes the panel and the page scrolls again', async ({ page }) => {
        await askFromPalette(page);
        expect(await page.evaluate(() => window.ScrollLock.holders.size)).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        // scroll-lock.js lets go of an aria-modal element from a MutationObserver.
        await expect.poll(() => page.evaluate(() => window.ScrollLock.holders.size)).toBe(0);
        expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    });

    test('Apply all leaves the deletion for its own click', async ({ page }) => {
        mode = 'three';
        await askFromPalette(page);
        const cards = panel(page).locator('[data-ai-proposal]');
        await expect(cards).toHaveCount(3);
        const destructive = panel(page).locator('[data-ai-proposal][data-destructive="true"]');
        await expect(destructive).toContainText('Delete a bookmark');
        const deleteId = await destructive.getAttribute('data-ai-proposal');

        const sent = page.waitForRequest((r) => r.url().endsWith('/api/ai/proposals/apply-all'));
        await panel(page).locator('[data-ai-apply-all]').click();
        const ids = JSON.parse((await sent).postData() || '{}').ids;
        expect(ids).toHaveLength(2);
        expect(ids).not.toContain(deleteId);

        await expect(panel(page).locator('[data-ai-proposal][data-status="applied"]')).toHaveCount(2);
        await expect(destructive.locator('[data-ai-apply]')).toBeVisible();
        await expect(panel(page).locator('[data-ai-apply-all]')).toHaveCount(0);
        const list = await (await page.request.get('/api/bookmarks?page=1')).json();
        const bookmark = list.find((b) => b.url === BOOKMARK_URL);
        // Both changes were made, and the deletion was not.
        expect(bookmark?.note).toBe(NEW_NOTE);
        expect(bookmark?.name).toBe('Assistant spec renamed');
    });

    test('Apply all is hidden with one pending proposal and shown with two', async ({ page }) => {
        await askFromPalette(page);
        await expect(panel(page).locator('[data-ai-proposal]')).toHaveCount(1);
        await expect(panel(page).locator('[data-ai-apply-all]')).toHaveCount(0);

        mode = 'two';
        await panel(page).locator('[data-ai-new]').click();
        await panel(page).locator('[data-ai-input]').fill('and again');
        await panel(page).locator('[data-ai-input]').press('Enter');
        await expect(panel(page).locator('[data-ai-proposal]')).toHaveCount(2);
        await expect(panel(page).locator('[data-ai-apply-all]')).toHaveCount(1);
    });

    test('markup in an answer, a title and an argument stays text', async ({ page }) => {
        mode = 'evil';
        await page.evaluate(() => { delete window.__xss; });
        await palette(page, `ask ${EVIL}`);
        await page.keyboard.press('Enter');
        await expect(panel(page).locator('[data-ai-proposal]')).toBeVisible();
        await expect(panel(page).locator('[data-ai-text]')).toContainText('<img src=x');
        await expect(panel(page).locator('[data-ai-proposal] dd', { hasText: '<img src=x' })).toHaveCount(1);
        await expect(panel(page).locator('[data-ai-conv]')).toContainText('<img src=x');
        await expect(panel(page).locator('img')).toHaveCount(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('a 401 on Apply says the write token is needed', async ({ page }) => {
        await page.route('**/api/ai/proposals/*/apply', (route) => route.fulfill({
            status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}',
        }));
        await askFromPalette(page);
        const card = panel(page).locator('[data-ai-proposal]');
        await card.locator('[data-ai-apply]').click();
        await expect(card).toContainText('Applying needs the write token.');
    });

    test('a stream that ends before done says the answer was cut off', async ({ page }) => {
        await page.route('**/api/ai/ask', (route) => route.fulfill({
            status: 200,
            contentType: 'application/x-ndjson',
            body: '{"type":"start","conversationId":""}\n{"type":"text","text":"Half an ans"}\n',
        }));
        await palette(page, 'ask cut me off');
        await page.keyboard.press('Enter');
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('Half an ans');
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('The answer was cut off.');
    });

    test('with the demo flag set the palette says the assistant is not available', async ({ page }) => {
        // The e2e server is not a demo; the row reads window.DemoLock, so set it there.
        await page.evaluate(() => { window.DemoLock = { ...(window.DemoLock || {}), on: true }; });
        await palette(page, 'ask anything');
        await expect(page.locator('#shortcut-search')).toContainText('The assistant is not available in the demo');
        await page.keyboard.press('Enter');
        await expect(panel(page)).toHaveCount(0);
        expect(requests).toBe(0);
    });

    test('Apply twice quickly applies once and the card stays Done', async ({ page }) => {
        await askFromPalette(page);
        const card = panel(page).locator('[data-ai-proposal]');
        await card.locator('[data-ai-apply]').dblclick();
        await expect(card).toContainText('Done');
        await expect(card.locator('[data-ai-proposal-error]')).toHaveCount(0);
    });

    test('closing the panel while it answers leaves a clean panel next time', async ({ page }) => {
        await page.route('**/api/ai/ask', async (route) => {
            await new Promise((r) => setTimeout(r, 1500));
            await route.abort().catch(() => {});
        });
        await palette(page, 'ask slow one');
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await page.unroute('**/api/ai/ask');
        await palette(page, 'ask which containers need an update');
        await page.keyboard.press('Enter');
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('Two containers need an update.');
        await expect(panel(page).locator('.assistant-msg--user')).toHaveCount(1);
    });

    test('a refused Apply for a switched-off group shows the server message and stays applicable', async ({ page }) => {
        await askFromPalette(page);
        const current = await (await page.request.get('/api/settings')).json();
        await page.request.post('/api/settings', { data: { ...current, mcpBookmarksWrite: false }, headers: AUTH });
        const card = panel(page).locator('[data-ai-proposal]');
        await card.locator('[data-ai-apply]').click();
        await expect(card).toContainText('That group is switched off under MCP access.');
        await expect(card.locator('[data-ai-apply]')).toBeVisible();
        await expect(card.locator('[data-ai-skip]')).toBeVisible();
    });
});
