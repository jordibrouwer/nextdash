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

let withMore = false;

/** The changes the stub proposes; Apply all adds a second change and a deletion. */
function proposedChanges() {
    const changes = [proposal({ url: BOOKMARK_URL, note: NEW_NOTE }, 'The note was empty.')];
    if (withMore) {
        changes.push(proposal({ url: BOOKMARK_URL, name: 'Assistant spec renamed' }, 'The name was vague.'));
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
                { choices: [{ delta: { content: 'Two containers' } }] },
                { choices: [{ delta: { content: ' need an update.' } }] },
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

async function configure(page, enabled) {
    const s = await (await page.request.get('/api/settings')).json();
    Object.assign(s, {
        aiEnabled: enabled, aiProvider: 'compatible', aiBaseURL: baseURL, aiModel: 'stub-model', mcpBookmarksWrite: true,
    });
    expect((await page.request.post('/api/settings', { data: s, headers: AUTH })).ok()).toBe(true);
    expect((await page.request.put('/api/ai/key', { data: { provider: 'compatible', key: 'stub-key' }, headers: AUTH })).ok()).toBe(true);
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

    test.beforeEach(async ({ page }) => {
        requests = 0;
        withMore = false;
        await page.request.delete('/api/ai/conversations', { headers: AUTH });
        await seedBookmark(page);
        await configure(page, true);
        await openApp(page);
    });

    test.afterEach(async ({ page }) => {
        // Put back what a test changed, whether or not it passed.
        const res = await page.request.get('/api/settings');
        if (res.ok()) {
            const s = await res.json();
            Object.assign(s, { aiEnabled: false, aiProvider: 'anthropic', aiBaseURL: '', aiModel: '', mcpBookmarksWrite: false });
            await page.request.post('/api/settings', { data: s, headers: AUTH });
        }
        for (const p of ['anthropic', 'openai', 'compatible']) {
            await page.request.delete(`/api/ai/key?provider=${p}`, { headers: AUTH });
        }
        await page.request.delete('/api/ai/conversations', { headers: AUTH });
        await removeBookmark(page);
    });

    test(':ask opens the panel, streams the answer and shows the token line', async ({ page }) => {
        await askFromPalette(page);
        await expect(panel(page).locator('.assistant-meta')).toHaveText(/^OpenAI-compatible · stub-model · 1[.,]240 tokens$/);
        await expect(panel(page).locator('[data-ai-input]')).toBeFocused();
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

    test('after a reload the conversation is in the sidebar and opens with its card', async ({ page }) => {
        await askFromPalette(page);
        await panel(page).locator('[data-ai-proposal] [data-ai-apply]').click();
        await expect(panel(page).locator('[data-ai-proposal]')).toContainText('Done');

        await openApp(page);
        await palette(page, 'ask');
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        const conv = panel(page).locator('[data-ai-conv]');
        await expect(conv).toHaveCount(1);
        await expect(conv).toContainText('which containers need an update');
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
        withMore = true;
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
        expect(list.some((b) => b.name === 'Assistant spec renamed' || b.note === NEW_NOTE)).toBe(true);
        expect(list.some((b) => b.url === BOOKMARK_URL)).toBe(true);
    });
});
