// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The title-cleanup fields (RSS widget settings, Watch feeds): Suggest fills the
 * pattern from the feed's own titles, the preview shows the first title before
 * and after, and a pattern the server cannot compile says so. The titles come
 * from a stubbed feed; the pattern is checked by the real server.
 */

const titles = [
    'NCSC-2026-0508 [1.00] [M/H] Kwetsbaarheden verholpen in F5 BIG-IP',
    'NCSC-2026-0507 [1.00] [M/H] Kwetsbaarheden verholpen in Drupal core',
    'NCSC-2026-0506 [1.00] [H/H] Kwetsbaarheden verholpen in NGINX door F5 Networks',
    'NCSC-2026-0505 [1.00] [M/H] Updates voor Windows',
];

async function drawBlock(page) {
    await markWhatsNewSeen(page);
    await page.route('**/api/widgets/rss**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: titles.map((title, i) => ({ title, link: `https://example.com/${i}` })) }),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'trf-host';
        host.innerHTML = window.TitleRewriteField.render({
            id: 'trf-test', source: 'data-trf-widget="w_1" data-trf-page="1"',
        });
        document.body.appendChild(host);
    });
}

test.describe('title cleanup fields', () => {
    test('Suggest fills the pattern and the preview shows the result', async ({ page }) => {
        await drawBlock(page);
        const host = page.locator('#trf-host');
        await host.locator('[data-trf-suggest]').click();
        await expect(host.locator('[data-trf-find]')).toHaveValue(/^\^NCSC-\\d\+-\\d\+ /);
        await expect(host.locator('[data-trf-preview]')).toBeVisible();
        await expect(host.locator('[data-trf-after]')).toHaveText(/^(F5 BIG-IP|Kwetsbaarheden verholpen in F5 BIG-IP)$/);
    });

    test('a pattern the server cannot compile says so and hides the preview', async ({ page }) => {
        await drawBlock(page);
        const host = page.locator('#trf-host');
        await host.locator('[data-trf-find]').fill('^NCSC-[');
        await expect(host.locator('[data-trf-error]')).toBeVisible();
        await expect(host.locator('[data-trf-preview]')).toBeHidden();
        // A lookahead is valid in a browser and refused by the server: the
        // preview must follow the server, not the page's own regexes.
        await host.locator('[data-trf-find]').fill('^(?=NCSC)');
        await expect(host.locator('[data-trf-error]')).toBeVisible();
        await host.locator('[data-trf-find]').fill('^NCSC-\\d+-\\d+ ');
        await expect(host.locator('[data-trf-error]')).toBeHidden();
        await expect(host.locator('[data-trf-preview]')).toBeVisible();
    });

    test('Suggest says so when nothing is sure enough', async ({ page }) => {
        await drawBlock(page);
        await page.unroute('**/api/widgets/rss**');
        await page.route('**/api/widgets/rss**', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ items: ['Alpha story', 'Beta story', 'Gamma tale', 'Delta report'].map((title) => ({ title })) }),
        }));
        // A fresh block, so its titles are fetched again.
        await page.evaluate(() => {
            document.getElementById('trf-host').innerHTML = window.TitleRewriteField.render({
                id: 'trf-test2', source: 'data-trf-widget="w_2" data-trf-page="1"',
            });
        });
        const host = page.locator('#trf-host');
        await host.locator('[data-trf-suggest]').click();
        await expect(host.locator('[data-trf-status]')).toBeVisible();
        await expect(host.locator('[data-trf-find]')).toHaveValue('');
    });
});
