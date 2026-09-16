// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithRows } = require('./config-bookmarks-helpers');

const ICON_32 = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>')}`;

const ROWS = [
    { name: 'Grafana', url: 'https://grafana.example', pageId: 1, category: 'mon', openCount: 3 },
    { name: 'Prometheus', url: 'https://prom.example', pageId: 1, category: 'mon', openCount: 9 },
    { name: 'Proxmox', url: 'https://pve.example', pageId: 1, category: 'virt', openCount: 1 },
    { name: 'Plex', url: 'https://plex.example', pageId: 1, category: '', openCount: 5 },
];

test.describe('groups in the bookmark list', () => {
    test('page order draws one slab per category, with a header per slab', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-sort', 'page');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        await expect(heads).toHaveCount(3);
        await expect(heads.first()).toContainText('2');
        await expect(page.locator('#config-bm-list .config-bm-crumb')).toHaveCount(0);
        await expect(page.locator('#config-bm-list .config-bm-row.is-group-start')).toHaveCount(3);
    });

    test('any other order is one slab, and every row says where it lives', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-sort', 'opens');
        await expect(page.locator('#config-bm-list .config-bm-group-head')).toHaveCount(0);
        await expect(page.locator('#config-bm-list .config-bm-crumb')).toHaveCount(4);
        await expect(page.locator('#config-bm-list .config-bm-title').first()).toHaveText('Prometheus');
    });

    test('a long domain gives way before the name does', async ({ page }) => {
        // Wide enough that the name fits its column once the domain is gone.
        await page.setViewportSize({ width: 1600, height: 800 });
        const long = 'https://a-very-long-subdomain-that-keeps-going.and-going.example.com/with/a/path';
        await openBookmarksWithRows(page, [
            { name: 'A reasonably long bookmark name', url: long, pageId: 1, category: '' },
        ]);
        const row = page.locator('#config-bm-list .config-bm-row').first();
        const sizes = await row.evaluate((el) => {
            const title = el.querySelector('.config-bm-title');
            const domain = el.querySelector('.config-bm-domain');
            return {
                titleClipped: title.scrollWidth > title.clientWidth,
                domainClipped: domain.scrollWidth > domain.clientWidth,
            };
        });
        expect(sizes.titleClipped, 'the name was cut').toBe(false);
        expect(sizes.domainClipped, 'the domain should be the one to give way').toBe(true);
    });

    test('a favicon shows whole inside its cell', async ({ page }) => {
        await openBookmarksWithRows(page, [
            // An inline 32px square, so the image loads without a server file.
            { name: 'Iconic', url: 'https://iconic.example', pageId: 1, icon: ICON_32 },
        ]);
        const row = page.locator('#config-bm-list .config-bm-row').first();
        const cell = await row.locator('.config-bm-icon-cell').boundingBox();
        const img = await row.locator('.config-bm-icon-cell img').boundingBox();
        expect(cell && img, 'the icon has a box').toBeTruthy();
        expect(img.width).toBeGreaterThanOrEqual(14);
        expect(img.x).toBeGreaterThanOrEqual(cell.x - 0.5);
        expect(img.y).toBeGreaterThanOrEqual(cell.y - 0.5);
        expect(img.x + img.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5);
        expect(img.y + img.height).toBeLessThanOrEqual(cell.y + cell.height + 0.5);
    });

    test('select group ticks the whole group', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-sort', 'page');
        await page.locator('#config-bm-list .config-bm-group-head').first()
            .locator('[data-bm-select-group]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(2);
        await expect(page.locator('#config-bm-list .config-bm-row[aria-selected="true"]')).toHaveCount(2);
    });

    test('select group reaches rows the window has not drawn', async ({ page }) => {
        const many = Array.from({ length: 400 }, (_, i) => ({
            name: `Row ${String(i).padStart(3, '0')}`, url: `https://r${i}.example`, pageId: 1, category: 'big',
        }));
        await openBookmarksWithRows(page, many);
        await page.selectOption('#config-bm-sort', 'page');
        await page.evaluate(() => { window.dashboardInstance.config.bmVisibleLimit = 400; });
        await page.selectOption('#config-bm-sort', 'name');
        await page.selectOption('#config-bm-sort', 'page');
        const drawn = await page.locator('#config-bm-list .config-bm-row').count();
        expect(drawn, 'the list is windowed').toBeLessThan(400);
        await page.locator('[data-bm-select-group]').first().click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(400);
    });
});
