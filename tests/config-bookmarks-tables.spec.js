const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Bookmarks -> Tags, Tag suggestions and Your rules on the same Health-style
 * table Structure -> Categories and Pages already use (see
 * config-structure-table.spec.js): one line per row, 46px tall, touching,
 * the row's name reading as text until it is hovered or focused, and its
 * actions out of sight until then.
 */

async function openStructureCategoriesRow(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
    await page.waitForSelector('.config-crud-list--table .config-crud-row', { timeout: 15_000 });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    return page.locator('.config-crud-list--table .config-crud-row').first();
}

/**
 * Same checks config-structure-table.spec.js runs on Categories/Pages/Finders,
 * pointed at a row from one of the three Bookmarks tabs plus the reference
 * row from Structure -> Categories, so a regression on either side fails it.
 */
async function assertMatchesReference(page, referenceRow, row, nameSel) {
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Same list class, same row class -- the actual unification, not just a
    // coincidentally similar height.
    expect(await row.evaluate((el) => el.closest('.config-crud-list--table') != null)).toBe(true);

    const refHeight = Math.round((await referenceRow.boundingBox()).height);
    const height = Math.round((await row.boundingBox()).height);
    expect(height).toBe(refHeight);
    expect(height).toBe(46);

    const name = row.locator(nameSel).first();
    await expect(name).toBeVisible();
    const nameStyle = await name.evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        fw: getComputedStyle(el).fontWeight,
    }));
    expect(nameStyle.bg).toBe('rgba(0, 0, 0, 0)');
    expect(nameStyle.fw).toBe('600');

    const actions = row.locator('.config-crud-row-actions').first();
    await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await row.hover();
    await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.mouse.move(0, 0);
}

test.describe('bookmarks tables read like Structure\'s rows', () => {
    test('Tags rows match Categories rows', async ({ page }) => {
        const referenceRow = await openStructureCategoriesRow(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('[data-bm-tab="tags"]').click();
        await page.waitForSelector('#config-bm-body .config-crud-list--table .config-crud-row', { timeout: 15_000 });
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement?.blur?.());
        const row = page.locator('#config-bm-body .config-crud-list--table .config-crud-row').first();
        await assertMatchesReference(page, referenceRow, row, '[data-tag-rename]');
        // Same toolbar shell as Structure's tabs: search box plus a sort select.
        await expect(page.locator('#config-bm-body .config-crud-toolbar')).toBeVisible();
    });

    test('Tag suggestions rows match Categories rows', async ({ page }) => {
        const referenceRow = await openStructureCategoriesRow(page);
        // Seed a suggestion: three bookmarks on one host already carry a tag,
        // the fourth does not, so the engine offers to catch it up.
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://bmtablecheck.example/one', tags: ['sample'] },
                { name: 'Two', url: 'https://bmtablecheck.example/two', tags: ['sample'] },
                { name: 'Three', url: 'https://bmtablecheck.example/three', tags: ['sample'] },
                { name: 'Four', url: 'https://bmtablecheck.example/four', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('[data-bm-tab="tag-suggestions"]').click();
        await expect(page.locator('#config-bm-suggestions [data-tag-suggestion]').first())
            .toBeVisible({ timeout: 15_000 });
        const row = page.locator('#config-bm-suggestions .config-crud-list--table .config-crud-row').first();
        await assertMatchesReference(page, referenceRow, row, '.config-suggestion-tag');
    });

    test('Your rules rows match Categories rows', async ({ page }) => {
        const referenceRow = await openStructureCategoriesRow(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            await cfg.addTagRule('bmtablecheck-rules.example', 'ruledtag');
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('[data-bm-tab="tag-rules"]').click();
        await expect(page.locator('#config-bm-tag-rules [data-tag-rule]').first())
            .toBeVisible({ timeout: 15_000 });
        const row = page.locator('#config-bm-tag-rules .config-crud-list--table .config-crud-row').first();
        await assertMatchesReference(page, referenceRow, row, '.config-suggestion-rule-text');
    });
});
