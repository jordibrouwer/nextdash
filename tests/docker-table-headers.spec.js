// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The containers table names its columns, and each heading sits over its
 * column. At phone width the rows fold into two lines, so the headings go.
 */

const base = {
    shortId: 'x', image: 'img', tag: 'latest', state: 'running', status: 'Up 1 hour', health: '', created: 1790000000,
};

async function open(page) {
    await mockDocker(page, { containers: [
        { ...base, id: 'a'.repeat(64), name: 'web', ports: [{ private: 80, public: 18181, type: 'tcp' }], webui: 'https://nd.home.lan/', webuiCustom: 'x' },
        { ...base, id: 'b'.repeat(64), name: 'db', state: 'exited', status: 'Exited (0)', ports: [] },
    ] });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(2);
}

test.describe('the containers table headings', () => {
    test('every column has a heading over it', async ({ page }) => {
        await open(page);
        const heads = page.locator('.docker-table thead th');
        await expect(heads).toHaveText(['Name', 'Image', 'Status', 'Size', 'Web UI', 'Ports']);
        const cells = ['name', 'image', 'state', 'size', 'webui', 'ports'];
        for (let i = 0; i < cells.length; i++) {
            const head = await heads.nth(i).boundingBox();
            const cell = await page.locator(`[data-docker-row="web"] .docker-cell--${cells[i]}`).boundingBox();
            expect(Math.round(head?.x || 0)).toBe(Math.round(cell?.x || 0));
        }
    });

    test('grouped by status, the headings stay above the groups', async ({ page }) => {
        await open(page);
        await page.locator('[data-docker-group]').selectOption('status');
        await expect(page.locator('.docker-group-row')).toHaveCount(2);
        await expect(page.locator('.docker-table thead th')).toHaveCount(6);
        await expect(page.locator('.docker-table thead + tbody .docker-group-row').first()).toBeVisible();
    });

    test('phone width hides the headings', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 800 });
        await open(page);
        await expect(page.locator('.docker-table thead')).toBeHidden();
    });
});
