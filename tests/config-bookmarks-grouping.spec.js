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
        await expect(row.locator('.config-bm-icon-cell img')).toBeVisible();
        // Both boxes in one read: the list can repaint between two calls.
        const { cell, img } = await row.evaluate((el) => {
            const box = (node) => {
                const r = node?.getBoundingClientRect();
                return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
            };
            return { cell: box(el.querySelector('.config-bm-icon-cell')), img: box(el.querySelector('.config-bm-icon-cell img')) };
        });
        expect(cell && img, 'the icon has a box').toBeTruthy();
        expect(img.width).toBeGreaterThanOrEqual(14);
        expect(img.x).toBeGreaterThanOrEqual(cell.x - 0.5);
        expect(img.y).toBeGreaterThanOrEqual(cell.y - 0.5);
        expect(img.x + img.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5);
        expect(img.y + img.height).toBeLessThanOrEqual(cell.y + cell.height + 0.5);
    });

    /*
     * The tag column is capped at 6rem by design — the columns right of the
     * title are capped so the name keeps the slack — so what fits is one short
     * chip beside the counter, not several long ones. The first tag here is
     * short on purpose: with eight long ones nothing fits at all, which is the
     * case below rather than this one.
     */
    test('tags that do not fit are counted, never cut', async ({ page }) => {
        const tags = ['db', 'observability', 'homelab-services', 'documentation',
            'infrastructure', 'automation', 'dashboards', 'monitoring'];
        // Wide enough for the tag column to reach its full width.
        await page.setViewportSize({ width: 1600, height: 800 });
        await openBookmarksWithRows(page, [
            { name: 'Tagged', url: 'https://tagged.example', pageId: 1, tags },
        ]);
        const cell = page.locator('#config-bm-list .config-bm-row').first().locator('.config-bm-tags');
        const more = cell.locator('.config-bm-tag--more');
        await expect(more).toBeVisible();
        await expect(more).toHaveText(/^\+\d+$/);
        const layout = await cell.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const shown = [...el.querySelectorAll('.config-bm-tag:not(.config-bm-tag--more)')]
                .filter((chip) => !chip.hidden);
            return {
                shown: shown.length,
                overflow: shown.some((chip) => chip.getBoundingClientRect().right > box.right + 0.5)
                    || el.querySelector('.config-bm-tag--more').getBoundingClientRect().right > box.right + 0.5,
            };
        });
        const n = Number((await more.textContent()).slice(1));
        expect(layout.shown).toBeGreaterThanOrEqual(1);
        expect(layout.shown + n).toBe(tags.length);
        expect(layout.overflow).toBe(false);
    });

    // And when not even one fits, the counter carries them all rather than a
    // chip being cut off at the edge of the column.
    test('when nothing fits, everything is counted', async ({ page }) => {
        const tags = ['observability', 'homelab-services', 'documentation', 'infrastructure'];
        await page.setViewportSize({ width: 1600, height: 800 });
        await openBookmarksWithRows(page, [
            { name: 'Tagged', url: 'https://tagged.example', pageId: 1, tags },
        ]);
        const cell = page.locator('#config-bm-list .config-bm-row').first().locator('.config-bm-tags');
        const more = cell.locator('.config-bm-tag--more');
        await expect(more).toHaveText(`+${tags.length}`);
        const overflow = await cell.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.querySelector('.config-bm-tag--more').getBoundingClientRect().right > box.right + 0.5;
        });
        expect(overflow, 'the counter itself runs past the column').toBe(false);
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

    test('a long category name is shown whole, in the group head and in the crumb', async ({ page }) => {
        // Wide enough for the title and the whole crumb side by side.
        await page.setViewportSize({ width: 1920, height: 900 });
        const name = 'selfhost-with-a-long-name';
        // Served by route, like the rows: the page's categories name the id.
        await page.route('**/api/categories?page=1', (route) => (route.request().method() === 'GET'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ id: 'shl', name, sortMode: 'order' }]),
            })
            : route.fallback()));
        await openBookmarksWithRows(page, [
            { name: 'Nextcloud with a fairly long bookmark name', url: 'https://cloud.example', pageId: 1, category: 'shl', openCount: 2 },
            { name: 'Plex', url: 'https://plex.example', pageId: 1, category: '', openCount: 1 },
        ]);
        const fits = (loc) => loc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

        await page.selectOption('#config-bm-sort', 'page');
        const label = page.locator('#config-bm-list .config-bm-group-head[data-bm-group$="::shl"] .config-bm-group-label');
        await expect(label).toContainText(name, { ignoreCase: true });
        expect(await fits(label)).toBe(true);

        await page.selectOption('#config-bm-sort', 'opens');
        const crumb = page.locator('#config-bm-list .config-bm-row').first().locator('.config-bm-crumb');
        await expect(crumb).toHaveText(new RegExp(` › ${name}$`));
        expect(await fits(crumb)).toBe(true);
        const box = await crumb.boundingBox();
        const cell = await page.locator('#config-bm-list .config-bm-row').first().locator('.config-bm-name').boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(cell.x + cell.width + 1);
        await expect(crumb).toHaveAttribute('title', new RegExp(`${name}$`));
        // The title gives way, but is still there.
        const title = page.locator('#config-bm-list .config-bm-row').first().locator('.config-bm-title');
        expect((await title.boundingBox()).width).toBeGreaterThan(0);
    });
});
