// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The toolbar's Columns list: untick a column and it leaves the headings and
 * every row, stays gone after a reload, and Reset columns brings it back.
 */
test('Columns hides a column, remembers it, and Reset brings it back', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    const heads = page.locator('.docker-table thead th');
    await expect(heads).toHaveText(['Name', 'Image', 'Status', 'Size', 'Web UI', 'Ports']);

    await page.locator('[data-docker-columns]').click();
    await page.locator('[data-docker-column="ports"]').uncheck();
    await page.locator('[data-docker-column="image"]').uncheck();
    await expect(heads).toHaveText(['Name', 'Status', 'Size', 'Web UI']);
    await expect(page.locator('.docker-cell--ports')).toHaveCount(0);
    await expect(page.locator('.docker-cell--image')).toHaveCount(0);
    // Every row has as many cells as there are headings.
    const cells = await page.locator('[data-docker-row="sonarr"] > td').count();
    expect(cells).toBe(4);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-docker-columns-pop]')).toBeHidden();
    await page.reload();
    await expect(heads).toHaveText(['Name', 'Status', 'Size', 'Web UI']);

    await page.locator('[data-docker-columns]').click();
    await page.locator('[data-docker-columns-reset]').click();
    await expect(heads).toHaveText(['Name', 'Image', 'Status', 'Size', 'Web UI', 'Ports']);
});

test('grouped, the band still spans the columns that show', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await page.locator('[data-docker-columns]').click();
    await page.locator('[data-docker-column="ports"]').uncheck();
    await page.keyboard.press('Escape');
    await page.locator('[data-docker-group]').selectOption('status');
    const spans = await page.locator('.docker-group-row td').evaluateAll((tds) => tds.map((td) => td.colSpan));
    expect(new Set(spans)).toEqual(new Set([5]));
});
