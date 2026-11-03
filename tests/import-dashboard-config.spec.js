// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The bookmark importer also reads the configuration of Homepage, Dashy and
 * Homer. The server does the reading; the browser sends the file as it is.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const dryRun = (page, body) => page.evaluate(async (text) => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const h = typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {};
    const res = await f('/api/bookmarks/import-html?page=1&dryRun=1', { method: 'POST', headers: h, body: text });
    return { status: res.status, body: res.ok ? await res.json() : null };
}, body);

test.describe('importing another dashboard', () => {
    test('a Homepage services file is counted before anything is written', async ({ page }) => {
        await openDashboard(page);
        const out = await dryRun(page, [
            '- Media:',
            '    - Jellyfin:',
            '        href: https://jellyfin.import-test.example',
            '        widget: { type: jellyfin, key: abc }',
            '    - Sonarr:',
            '        href: https://sonarr.import-test.example',
            '- Network:',
            '    - Router:',
            '        href: https://router.import-test.example',
        ].join('\n'));
        expect(out.status).toBe(200);
        expect(out.body.total).toBe(3);
        expect(out.body.new).toBe(3);
        expect(out.body.folders).toBe(2);
    });

    test('Dashy and Homer files are read too', async ({ page }) => {
        await openDashboard(page);
        const dashy = await dryRun(page, 'sections:\n  - name: Tools\n    items:\n      - title: A\n        url: https://a.import-test.example\n');
        expect(dashy.body.total).toBe(1);
        const homer = await dryRun(page, 'services:\n  - name: Apps\n    items:\n      - name: B\n        url: https://b.import-test.example\n');
        expect(homer.body.total).toBe(1);
    });

    test('a file that is none of them yields no links', async ({ page }) => {
        await openDashboard(page);
        const out = await dryRun(page, 'title: Dashboard\ntheme: dark\n');
        expect(out.body?.total ?? 0).toBe(0);
    });

    test('Data & backups offers a YAML file next to the HTML one', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.location.hash = '#config/data-backups'; });
        const accept = await page.locator('#config-browser-import-input').getAttribute('accept', { timeout: 20_000 });
        expect(accept).toContain('.yaml');
        expect(accept).toContain('.html');
    });
});
