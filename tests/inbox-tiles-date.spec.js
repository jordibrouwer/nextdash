const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Inbox parity with the health view: summary tiles above the feed and an absolute
 * added date on each row. Seeds one fresh inbox item, then asserts the tiles and
 * the row date render.
 */
test.describe('inbox summary tiles and added date', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    });

    test('renders four summary tiles and an added date on each row', async ({ page }) => {
        const seedUrl = `https://tiles-seed-${Date.now()}.example.com`;
        await page.evaluate(async (url) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, title: 'Tiles seed' }),
            });
        }, seedUrl);

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        // The view may have rendered before the seed POST landed; reload rather
        // than waiting on a render that has already happened.
        await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
        await page.waitForSelector('.inbox-item', { timeout: 15_000 });

        // Four tiles, in order: Active, Unread, Snoozed, This week. "Active"
        // rather than "Total" because a sleeping link is in none of them.
        const tiles = page.locator('.inbox-tiles .inbox-tile');
        await expect(tiles).toHaveCount(4);
        const labels = await page.locator('.inbox-tiles .inbox-tile-label').allTextContents();
        expect(labels.map((l) => l.toLowerCase())).toEqual(['active', 'unread', 'snoozed', 'this week']);

        // The first three are filter buttons; "This week" is a plain readout.
        await expect(page.locator('button.inbox-tile[data-inbox-tile="all"]')).toBeVisible();
        await expect(page.locator('button.inbox-tile[data-inbox-tile="unread"]')).toBeVisible();
        await expect(page.locator('button.inbox-tile[data-inbox-tile="snoozed"]')).toBeVisible();

        // A freshly-seeded item counts toward Active, Unread and This week (all >= 1).
        const seededRow = page.locator('.inbox-item').filter({ hasText: 'Tiles seed' });
        await expect(seededRow).toHaveCount(1);
        await expect(seededRow.locator('.inbox-item-date')).toHaveText(/\w/);

        // Clicking the Unread tile activates the unread filter.
        await page.locator('button.inbox-tile[data-inbox-tile="unread"]').click();
        await expect(page.locator('button.inbox-tile[data-inbox-tile="unread"]')).toHaveClass(/is-active/);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.filter)).toBe('unread');
    });

    test('inbox icon matches the health icon: 3rem square in the first column', async ({ page }) => {
        // Serve the favicon so the <img> loads instead of falling back to the glyph.
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
        await page.route('**/data/icons/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));

        // Inject an item with an icon set, bypassing async enrichment.
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.evaluate(() => {
            window.dashboardInstance.inbox.items = [
                { id: 'icon-a', url: 'https://github.com/x', title: 'Icon seed', domain: 'github.com', addedAt: Date.now(), icon: 'seed.png' },
            ];
            window.dashboardInstance.inbox.loading = false;
            window.dashboardInstance.inbox.render();
        });
        await page.waitForSelector('.inbox-item-thumb', { timeout: 15_000 });

        // 3rem at the default 16px root = 48px.
        const thumb = page.locator('.inbox-item-thumb').first();
        const width = await thumb.evaluate((el) => el.getBoundingClientRect().width);
        expect(Math.round(width)).toBe(48);

        // A stored icon renders as an <img> resolved to /data/icons/, like health.
        const img = thumb.locator('.inbox-item-thumb-img');
        await expect(img).toHaveAttribute('src', '/data/icons/seed.png');

        // The icon is the first laid-out child of the row (no leading checkbox
        // column pushing it right): its left edge sits within the row's padding,
        // matching the health view. The checkbox overlays it rather than preceding it.
        const box = await page.evaluate(() => {
            const item = document.querySelector('.inbox-item');
            const th = item.querySelector('.inbox-item-thumb');
            const ir = item.getBoundingClientRect();
            const tr = th.getBoundingClientRect();
            return { gap: tr.left - ir.left };
        });
        // 0.85rem padding = ~13.6px; allow a small tolerance. A leading 1.4rem
        // checkbox column would have pushed this past ~35px.
        expect(box.gap).toBeLessThan(20);
    });
});
