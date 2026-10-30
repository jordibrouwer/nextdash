// @ts-check
const http = require('http');
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The `=` search mode: a lone `=` lists the latest assistant conversations,
 * `=question` asks it, and what follows the `=` never leaves the search bar.
 * Runs against a stub OpenAI-compatible server the spec starts itself.
 */
const AUTH = { 'X-NextDash-Token': WRITE_TOKEN };
const QUESTION = 'welke containers hebben een update?';

/** @type {import('http').Server} */
let server;
let baseURL = '';
/** @type {string[]} */
let received = [];

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
                res.writeHead(404).end();
                return;
            }
            let body = {};
            try { body = JSON.parse(raw); } catch { /* answered as an empty turn */ }
            const user = (body.messages || []).filter((m) => m.role === 'user').pop();
            received.push(String(user?.content || ''));
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const chunks = [
                { choices: [{ delta: { content: 'Stub answer.' } }] },
                { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
            ];
            for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`;
});

test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

async function configure(page, enabled) {
    const s = await (await page.request.get('/api/settings')).json();
    Object.assign(s, { aiEnabled: enabled, aiProvider: 'compatible', aiBaseURL: baseURL, aiModel: 'stub-model' });
    expect((await page.request.post('/api/settings', { data: s, headers: AUTH })).ok()).toBe(true);
}

async function ask(page, question) {
    const res = await page.request.post('/api/ai/ask', { data: { conversationId: '', question }, headers: AUTH });
    expect(res.ok()).toBe(true);
    await res.text();
}

async function openApp(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Through the keys someone presses: `>` opens the bar, then the rest is typed. */
async function typeInBar(page, text) {
    await page.evaluate(() => { document.body.focus(); });
    await page.keyboard.press('>');
    await expect(page.locator('#search-scope-rail')).toBeVisible();
    await page.keyboard.type(text);
}

const panel = (page) => page.locator('.assistant-panel');
const bar = (page) => page.locator('#shortcut-search');

test.describe('Assistant search mode', () => {
    test.describe.configure({ mode: 'serial' });

    let priorSettings = null;
    let priorConversations = new Set();

    test.beforeEach(async ({ page }) => {
        received = [];
        priorSettings = await (await page.request.get('/api/settings')).json();
        priorConversations = new Set((await (await page.request.get('/api/ai/conversations')).json()).map((c) => c.id));
        await configure(page, true);
    });

    test.afterEach(async ({ page }) => {
        if (priorSettings) await page.request.post('/api/settings', { data: priorSettings, headers: AUTH });
        const now = await (await page.request.get('/api/ai/conversations')).json();
        for (const c of now) {
            if (!priorConversations.has(c.id)) await page.request.delete(`/api/ai/conversations/${c.id}`, { headers: AUTH });
        }
    });

    test('a lone = lists the latest conversations and Enter opens one', async ({ page }) => {
        await ask(page, 'first mode question');
        await ask(page, 'second mode question');
        await openApp(page);
        await typeInBar(page, '=');

        await expect(page.locator('.search-mode-tab[data-mode="assistant"]')).toHaveClass(/active/);
        const rows = bar(page).locator('.search-match');
        await expect(rows.first()).toContainText('second mode question');
        await expect(rows.nth(1)).toContainText('first mode question');

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('first mode question');
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('Stub answer.');
        await expect(panel(page).locator('[data-ai-input]')).toBeFocused();
        expect(received).toHaveLength(2);
    });

    test('= pressed on the dashboard opens the assistant mode by itself', async ({ page }) => {
        await ask(page, 'dashboard key question');
        await openApp(page);
        await page.evaluate(() => { document.body.focus(); });
        await page.keyboard.press('=');
        await expect(page.locator('#search-scope-rail')).toBeVisible();
        await expect(page.locator('.search-mode-tab[data-mode="assistant"]')).toHaveClass(/active/);
        await expect(bar(page).locator('.search-match').first()).toContainText('dashboard key question');
    });

    test('a lone = with no conversations offers to ask', async ({ page }) => {
        await openApp(page);
        const count = await page.evaluate(async () => (await (await fetch('/api/ai/conversations')).json()).length);
        test.skip(count > 0, 'the data folder already holds conversations');
        await typeInBar(page, '=');
        await expect(bar(page).locator('.search-match')).toHaveText(/Ask the assistant/);
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        await expect(panel(page).locator('[data-ai-input]')).toBeFocused();
        expect(received).toHaveLength(0);
    });

    test('=question opens the panel and sends the question', async ({ page }) => {
        await openApp(page);
        await typeInBar(page, `=${QUESTION}`);
        await expect(bar(page).locator('.search-match')).toHaveText(new RegExp(`Ask: ${QUESTION.replace('?', '\\?')}`));
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('Stub answer.');
        await expect(panel(page).locator('[data-ai-input]')).toBeFocused();
        expect(received).toEqual([QUESTION]);
    });

    test('an = inside a normal query stays a character', async ({ page }) => {
        await openApp(page);
        await typeInBar(page, 'a=b');
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toBe('a=b');
        await expect(page.locator('.search-mode-tab[data-mode="assistant"]')).not.toHaveClass(/active/);
        await expect(page.locator('.search-mode-tab[data-mode="search"]')).toHaveClass(/active/);
    });

    test('with the assistant off the row says so and Enter opens Config → AI Assistant', async ({ page }) => {
        await configure(page, false);
        await openApp(page);
        await typeInBar(page, '=');
        await expect(bar(page).locator('.search-match')).toHaveText(/The assistant is off\. Set it up in Config/);
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-ai-panel]')).toBeVisible();
        await expect(page).toHaveURL(/#config\/assistant\/settings$/);
        await expect(panel(page)).toHaveCount(0);
        expect(received).toHaveLength(0);
    });

    test('Backspace on the lone = leaves the mode', async ({ page }) => {
        await openApp(page);
        await typeInBar(page, '=');
        await expect(page.locator('.search-mode-tab[data-mode="assistant"]')).toHaveClass(/active/);
        await page.keyboard.press('Backspace');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toBe('');
        await expect(page.locator('.search-mode-tab[data-mode="assistant"]')).not.toHaveClass(/active/);
    });

    test('the question is neither tracked nor stored', async ({ page }) => {
        const tracked = [];
        page.on('request', (r) => { if (r.url().includes('/api/track-search')) tracked.push(r.postData() || ''); });
        await openApp(page);
        await typeInBar(page, `=${QUESTION}`);
        await page.keyboard.press('Enter');
        await expect(panel(page).locator('[data-ai-thread]')).toContainText('Stub answer.');
        const stored = await page.evaluate(() => JSON.stringify([
            localStorage.getItem('dashboardRecentCommands'), localStorage.getItem('dashboardSearchHistory'),
        ]));
        expect(stored).not.toContain('containers');
        expect(tracked.join('')).not.toContain('containers');
    });

    test('with a web engine on, =question offers no web search and Shift+Enter asks nothing', async ({ page }) => {
        const engine = [];
        const stub = http.createServer((req, res) => {
            engine.push(req.url);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results: [], infoboxes: [] }));
        });
        await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
        try {
            const s = await (await page.request.get('/api/settings')).json();
            Object.assign(s, { webSearchEngine: 'searxng', webSearchSearxngUrl: `http://127.0.0.1:${/** @type {any} */ (stub.address()).port}` });
            expect((await page.request.post('/api/settings', { data: s, headers: AUTH })).ok()).toBe(true);
            await openApp(page);
            await typeInBar(page, `=${QUESTION}`);
            await expect(bar(page).locator('.search-match')).toHaveText(/Ask: /);
            await expect(bar(page)).not.toContainText('Search the web');
            await page.keyboard.press('Shift+Enter');
            await page.waitForTimeout(600);
            // Shift+Enter is plain Enter here: the assistant gets the question, the engine nothing.
            expect(engine).toHaveLength(0);
        } finally {
            await new Promise((resolve) => stub.close(resolve));
        }
    });

    test('= followed only by a space still redraws when the conversations arrive', async ({ page }) => {
        await ask(page, 'space mode question');
        await openApp(page);
        await typeInBar(page, '= ');
        await expect(bar(page).locator('.search-match').first()).toContainText('space mode question');
    });
});
