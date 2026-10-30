// @ts-check
const http = require('http');
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * How the assistant panel shows an answer: the small Markdown subset as
 * elements, links to places in the app that open them, and everything else as
 * the characters it was sent as. A stub OpenAI-compatible server streams the
 * answer the spec sets, cut into pieces in the middle of the markers.
 */
const AUTH = { 'X-NextDash-Token': WRITE_TOKEN };

/** @type {import('http').Server} */
let server;
let baseURL = '';
let answer = '';

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const pieces = answer.match(/[\s\S]{1,7}/g) || [];
            for (const content of pieces) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
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

const panel = (page) => page.locator('.assistant-panel');
const text = (page) => panel(page).locator('.assistant-text').last();

async function ask(page, markdown) {
    answer = markdown;
    await page.evaluate(() => { document.body.focus(); });
    await page.keyboard.press(':');
    await page.keyboard.type('ask anything');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('.assistant-meta')).toBeVisible();
}

test.describe('Assistant answers', () => {
    test.describe.configure({ mode: 'serial' });

    let priorSettings = null;
    let priorConversations = new Set();

    test.beforeEach(async ({ page }) => {
        priorSettings = await (await page.request.get('/api/settings')).json();
        priorConversations = new Set((await (await page.request.get('/api/ai/conversations')).json()).map((c) => c.id));
        const s = await (await page.request.get('/api/settings')).json();
        Object.assign(s, { aiEnabled: true, aiProvider: 'compatible', aiBaseURL: baseURL, aiModel: 'stub-model' });
        expect((await page.request.post('/api/settings', { data: s, headers: AUTH })).ok()).toBe(true);
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.evaluate(() => { delete window.__xss; });
    });

    test.afterEach(async ({ page }) => {
        if (priorSettings) await page.request.post('/api/settings', { data: priorSettings, headers: AUTH });
        const now = await (await page.request.get('/api/ai/conversations')).json();
        for (const c of now) {
            if (!priorConversations.has(c.id)) await page.request.delete(`/api/ai/conversations/${c.id}`, { headers: AUTH });
        }
    });

    test('bold, lists, inline code and a code block become elements', async ({ page }) => {
        await ask(page, [
            'Here is **how it works**:', '',
            '- first `item`', '- second *one*', '',
            '1. step one', '2. step two', '',
            '```', 'npm run build', '```', '',
            '### A heading', 'and a snake_case_name stays.',
        ].join('\n'));
        const t = text(page);
        await expect(t.locator('strong').first()).toHaveText('how it works');
        await expect(t.locator('ul > li')).toHaveCount(2);
        await expect(t.locator('ul > li code')).toHaveText('item');
        await expect(t.locator('ul > li em')).toHaveText('one');
        await expect(t.locator('ol > li')).toHaveCount(2);
        await expect(t.locator('pre code')).toHaveText('npm run build');
        await expect(t.locator('.assistant-md-heading strong')).toHaveText('A heading');
        const shown = await t.innerText();
        expect(shown).not.toContain('**');
        expect(shown).not.toContain('```');
        expect(shown).not.toContain('### ');
        expect(shown).toContain('snake_case_name');
    });

    test('the answer reads in the UI font at a limited measure, code stays mono', async ({ page }) => {
        await ask(page, 'Press `Shift + M` to **open** it, then read on.\n\n- one\n- two');
        const t = text(page);
        await expect(t.locator('code')).toHaveText('Shift + M');
        const read = () => page.evaluate(() => {
            const answer = /** @type {HTMLElement} */ (document.querySelector('.assistant-panel .assistant-msg--assistant:last-child .assistant-text'));
            const cs = (n) => getComputedStyle(n);
            return {
                prose: cs(answer).fontFamily,
                mono: getComputedStyle(document.documentElement).getPropertyValue('--font-family-mono').trim(),
                ui: getComputedStyle(document.documentElement).getPropertyValue('--font-family-ui').trim(),
                code: cs(/** @type {Element} */ (answer.querySelector('code'))).fontFamily,
                maxWidth: cs(answer).maxWidth,
                preset: document.documentElement.getAttribute('data-font-preset'),
            };
        });
        const norm = (v) => v.replace(/["']/g, '').replace(/\s+/g, ' ');
        const mono = await read();
        // A monospace dashboard font: the answer takes the UI sans, code the mono.
        expect(['source-code-pro', 'jetbrains-mono', 'ibm-plex-mono']).toContain(mono.preset);
        expect(norm(mono.prose)).toBe(norm(mono.ui));
        expect(norm(mono.prose)).not.toBe(norm(mono.code));
        expect(norm(mono.code)).toContain(norm(mono.mono).split(',')[0]);
        expect(mono.maxWidth).not.toBe('none');
        // A sans dashboard font: the answer follows it.
        await page.evaluate(() => window.DashboardFont.applyMainFont({ fontPreset: 'dm-sans' }));
        const sans = await read();
        expect(sans.preset).toBe('dm-sans');
        expect(norm(sans.prose)).toContain('DM Sans');
        expect(norm(sans.code)).not.toContain('DM Sans');
    });

    test('a link to a place in the app opens it and closes the panel', async ({ page }) => {
        await ask(page, 'Open [Config → Containers](#config/containers) to see it.');
        const link = text(page).locator('a.assistant-link');
        await expect(link).toHaveText('Config → Containers');
        await link.focus();
        await page.keyboard.press('Enter');
        await expect(panel(page)).toHaveCount(0);
        // The app settles on the section's first tab.
        await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#config\/containers/);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
        await expect(page.locator('[data-config-section="containers"].is-active')).toBeVisible();
    });

    test('anything else stays literal text and runs nothing', async ({ page }) => {
        const hostile = [
            '[x](https://evil.example)', '[y](javascript:alert(1))', '[z](#config/a/b/c)', '[w](#evil)', '[v](/relative)',
            '<img src=x onerror="window.__xss=1">', '<script>window.__xss=2</script>', '<b>not bold</b>',
        ];
        await ask(page, hostile.join('\n'));
        const t = text(page);
        const shown = await t.innerText();
        for (const piece of hostile) expect(shown).toContain(piece);
        await expect(t.locator('a, img, script, b')).toHaveCount(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });
});
