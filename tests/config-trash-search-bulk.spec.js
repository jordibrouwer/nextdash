const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The trash held up to 500 entries as a flat list with per-row buttons only.
 * Restoring a twenty-item bulk delete meant twenty clicks with no way to search
 * — on the one screen where the user is under time pressure.
 */
async function openTrash(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#config');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.dbTab = 'trash';
        c.openConfigView('data-backups');
    });
    await page.waitForSelector('#config-db-body', { timeout: 15_000 });
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c._trashData = {
            retentionDays: 30,
            items: [
                { id: 't1', kind: 'bookmark', deletedAt: Date.now(), pageName: 'Main', bookmark: { name: 'Alpha docs', url: 'https://alpha.example' } },
                { id: 't2', kind: 'bookmark', deletedAt: Date.now(), pageName: 'Main', bookmark: { name: 'Beta wiki', url: 'https://beta.example' } },
                { id: 't3', kind: 'page', deletedAt: Date.now(), trashedPage: { page: { name: 'Gamma page' }, bookmarks: [1, 2] } },
            ],
        };
        c._trashLoadFailed = false;
        c._trashQuery = '';
        c._trashSelected = new Set();
        c.repaintTrashBody();
    });
    await page.waitForSelector('[data-trash-search]', { timeout: 10_000 });
}

test.describe('trash search and bulk restore', () => {
    test('searching narrows the list', async ({ page }) => {
        await openTrash(page);
        await expect(page.locator('.config-backup-row')).toHaveCount(3);

        await page.locator('[data-trash-search]').fill('beta');
        await expect(page.locator('.config-backup-row')).toHaveCount(1);
        await expect(page.locator('.config-backup-name')).toHaveText(/Beta wiki/);
    });

    test('search matches a page name too, not just bookmarks', async ({ page }) => {
        await openTrash(page);
        await page.locator('[data-trash-search]').fill('gamma');
        await expect(page.locator('.config-backup-row')).toHaveCount(1);
    });

    test('a search with no hits says so instead of showing an empty trash', async ({ page }) => {
        await openTrash(page);
        await page.locator('[data-trash-search]').fill('nothing-matches-this');
        await expect(page.locator('.config-panel-empty')).toContainText(/matches that search/i);
    });

    test('select all covers what the search shows, not the whole trash', async ({ page }) => {
        await openTrash(page);
        await page.locator('[data-trash-search]').fill('beta');
        await page.locator('[data-trash-action="select-all"]').click();

        const selected = await page.evaluate(() => [...window.dashboardInstance.config._trashSelected]);
        expect(selected).toEqual(['t2']);
    });

    test('restore selected calls restore once per ticked row', async ({ page }) => {
        await openTrash(page);
        const calls = await page.evaluate(async () => {
            const seen = [];
            window.DashboardTrash.restore = async (id) => { seen.push(id); return { kind: 'bookmark' }; };
            const c = window.dashboardInstance.config;
            c._trashSelected = new Set(['t1', 't2']);
            await c.restoreSelectedTrash();
            return seen;
        });
        expect(calls.sort()).toEqual(['t1', 't2']);
    });

    test('one failure does not take the rest of the batch with it', async ({ page }) => {
        await openTrash(page);
        const outcome = await page.evaluate(async () => {
            const seen = [];
            window.DashboardTrash.restore = async (id) => {
                seen.push(id);
                if (id === 't1') throw new Error('page no longer exists');
                return { kind: 'bookmark' };
            };
            const c = window.dashboardInstance.config;
            let said = '';
            c.notify = (msg) => { said = msg; };
            c._trashSelected = new Set(['t1', 't2']);
            await c.restoreSelectedTrash();
            return { seen, said };
        });
        expect(outcome.seen.sort()).toEqual(['t1', 't2']);
        expect(outcome.said).toMatch(/could not be restored/i);
    });

    test('a failed load is not reported as an empty trash', async ({ page }) => {
        await openTrash(page);
        const text = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c._trashLoadFailed = true;
            c._trashData = { items: [], retentionDays: 30 };
            c.repaintTrashBody();
            return document.getElementById('config-db-body').innerText;
        });
        expect(text).toMatch(/could not be loaded/i);
        expect(text).not.toMatch(/trash is empty/i);
    });
});
