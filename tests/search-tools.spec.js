// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The small homelab tools in the search panel (search-tools.js): hashes, base64,
 * a subnet, a cron line, a port. Each has a word or shape of its own, so what
 * they refuse matters as much as what they answer.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.SearchTools, null, { timeout: 20_000 });
}

test.describe('search tools', () => {
    test('hashes match the known values, texts with accents included', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const r = (q) => window.SearchTools.evaluate(q)?.result ?? null;
            return {
                md5: r('md5 hello'), sha1: r('sha1 abc'), sha256: r('sha256 abc'),
                empty56: r(`sha256 ${'a'.repeat(56)}`),
                accent: r('md5 héllo'),
            };
        });
        expect(out.md5).toBe('5d41402abc4b2a76b9719d911017c592');
        expect(out.sha1).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
        expect(out.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        // 56 bytes is where the padding spills into a second block.
        expect(out.empty56).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
        expect(out.accent).toBe('be50e8478cf24ff3595bc7307fb91b50');
    });

    test('encodes, decodes and answers the network and file questions', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const r = (q) => window.SearchTools.evaluate(q)?.result ?? null;
            return {
                b64: r('base64 héllo'), unb64: r('base64 decode aMOpbGxv'),
                enc: r('urlencode a b&c'), dec: r('urldecode a%20b%26c'),
                cidr: r('192.168.1.0/24'), odd: r('10.0.0.5/22'), host: r('10.0.0.1/32'),
                mask: r('255.255.255.0'), prefix: r('mask 22'),
                port: r('8096'), portWord: r('port 22'),
                chmod: r('chmod 755'), special: r('chmod 4755'), back: r('rwxr-xr-x'),
                ts: r('1700000000'), tsMs: r('1700000000000'),
            };
        });
        expect(out).toMatchObject({
            b64: 'aMOpbGxv', unb64: 'héllo', enc: 'a%20b%26c', dec: 'a b&c',
            mask: '/24', prefix: '255.255.252.0', port: 'Jellyfin', portWord: 'SSH',
            chmod: 'rwxr-xr-x', special: 'rwsr-xr-x', back: '755',
        });
        expect(out.cidr).toBe('192.168.1.0 – 192.168.1.255 · 256 addresses · 254 usable · mask 255.255.255.0');
        expect(out.odd).toContain('10.0.0.0 – 10.0.3.255');
        expect(out.host).toContain('1 address ');
        expect(out.ts).toContain('2023-11-14T22:13:20.000Z');
        expect(out.tsMs).toBe(out.ts);
    });

    test('uuid and password are random and shaped right', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const a = window.SearchTools.evaluate('uuid').result;
            const b = window.SearchTools.evaluate('uuid').result;
            return { a, b, pass: window.SearchTools.evaluate('pass 24').result };
        });
        expect(out.a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(out.a).not.toBe(out.b);
        expect(out.pass).toHaveLength(24);
    });

    test('cron says what a line means and when it runs next', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const r = (q) => window.SearchTools.evaluate(q)?.result ?? null;
            return {
                every: r('cron */5 * * * *'), daily: r('cron @daily'), week: r('cron 0 9 * * 1-5'),
                never: r('cron 0 0 31 2 *'), bad: r('cron 61 * * * *'), words: r('cron a b c d e'),
            };
        });
        expect(out.every).toMatch(/^every 5 minutes · next \d{4}-\d\d-\d\d \d\d:\d[05], /);
        expect(out.daily).toMatch(/^at 00:00 every day · next /);
        expect(out.week).toMatch(/^at 09:00 on Monday to Friday · next /);
        const copies = await page.evaluate(() => ({
            line: window.SearchTools.evaluate('cron 0 9 * * 1-5').copy,
            short: window.SearchTools.evaluate('cron @daily').copy,
        }));
        // Enter copies the schedule to paste into a crontab, not the sentence about it.
        expect(copies).toEqual({ line: '0 9 * * 1-5', short: '0 0 * * *' });
        expect(out.never).toBeNull();
        expect(out.bad).toBeNull();
        expect(out.words).toBeNull();
    });

    test('a word, a name or an unknown number is never an answer', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const q = ['hello', 'pass', 'password', 'uuid please', 'md5', 'sha256', 'base64', 'cron', 'chmod',
                '4', '1234', '12345678', '123456789012', '99999', '70000', '1.2.3.4', '255.0.255.0',
                '300.1.1.1/24', '1.2.3.4/33', 'pass 4', 'chmod 999', 'port 4', '9999999999', '0000000000',
                'ts', 'urldecode %E0%A4%A', 'base64 decode !!!', 'mask 40'];
            return q.filter((x) => window.SearchTools.evaluate(x));
        });
        expect(out).toEqual([]);
    });

    test('is the first row in the panel and Enter copies the answer', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            window.__copied = null;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
        });
        await page.keyboard.press('>');
        await page.keyboard.type('192.168.1.0/24');
        const first = page.locator('#search-matches .search-match').first();
        await expect(first).toContainText('256 addresses');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__copied), { timeout: 5000 }).toBe('192.168.1.0 – 192.168.1.255');
    });

    test('a prefix keeps its own meaning, and a plain word has no tool row', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.keyboard.type(':sha256 abc');
        const hasRow = await page.evaluate(() => (window.dashboardInstance.searchComponent.searchMatches || []).some((m) => m.calc));
        expect(hasRow).toBe(false);
    });

    test('a copied line can be pasted into the open panel and is answered', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        // A real paste event, the way the browser sends one on Cmd/Ctrl+V.
        await page.evaluate(() => {
            const data = new DataTransfer();
            data.setData('text/plain', '  cron 0 9 * * 1-5\n');
            document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        await expect(page.locator('#search-matches .search-match').first()).toContainText('at 09:00 on Monday to Friday');
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toBe('cron 0 9 * * 1-5');
    });

    test('a paste with the panel closed still goes to quick-add, not the panel', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.pasteDestination = 'bookmark'; });
        await page.evaluate(() => {
            const data = new DataTransfer();
            data.setData('text/plain', 'https://paste.example/page');
            document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toBe('');
    });

    test('typing a tool\'s command is helped by suggestions', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const sug = (q) => window.SearchTools.suggest(q).map((h) => ({ c: h.completion, top: h.top }));
            return {
                part: sug('cr'), one: sug('c'), word: sug('pass'), spaced: sug('pass '),
                wrong: sug('cron 61 * * * *').map((h) => h.c), answered: sug('cron 0 9 * * 1-5'),
                ip: sug('192.168.1.0'), plain: sug('hello'),
            };
        });
        // First letters nudge from under the list; a bare word may be a bookmark, so also under it.
        expect(out.part).toEqual([{ c: 'cron ', top: false }]);
        expect(out.one).toEqual([]);
        expect(out.word.every((h) => h.top === false) && out.word.length).toBeTruthy();
        // A word and a space, or a wrong argument, is a tool's command: help on top.
        expect(out.spaced.every((h) => h.top === true) && out.spaced.length).toBeTruthy();
        expect(out.wrong).toContain('cron 0 9 * * 1-5');
        expect(out.answered).toEqual([]);
        expect(out.ip).toEqual([{ c: '192.168.1.0/24', top: true }]);
        expect(out.plain).toEqual([]);
    });

    test('picking a suggestion fills the command in and the answer follows', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.keyboard.type('cron ');
        const first = page.locator('#search-matches .search-match').first();
        await expect(first).toContainText('cron 0 9 * * 1-5');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toBe('cron 0 9 * * 1-5');
        await expect(page.locator('#search-matches .search-match').first()).toContainText('at 09:00 on Monday to Friday');

        // The first letters of a word are offered too.
        await page.keyboard.press('Escape');
        await page.keyboard.press('>');
        await page.keyboard.type('sha');
        await expect(page.locator('#search-matches')).toContainText('sha256 <text>');
    });

    test('the words around an answer follow the language, the answer does not', async ({ page }) => {
        await openDashboard(page);
        const nl = await page.evaluate(async () => {
            await window.dashboardInstance.language.loadTranslations('nl');
            const r = (q) => window.SearchTools.evaluate(q)?.result ?? null;
            return {
                cron: r('cron 0 9 * * 1-5'), cidr: r('192.168.1.0/24'),
                hint: window.SearchTools.suggest('sha').map((h) => h.meta)[0],
            };
        });
        // Day names come from Intl in the dashboard's language; the commands stay as typed.
        expect(nl.cron).toMatch(/^om 09:00 op maandag tot vrijdag · volgende \d{4}-/);
        expect(nl.cidr).toBe('192.168.1.0 – 192.168.1.255 · 256 adressen · 254 bruikbaar · masker 255.255.255.0');
        expect(nl.hint).toBe('Een tekst hashen');
    });
});
