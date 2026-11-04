// @ts-check
/*
 * nextdash.cc feature-page pictures, set E: config, data, find, themes, widgets.
 * Full frames, 1440x900, Tarnished Brass dark, on the public demo seed.
 */
const fs = require('fs');
const path = require('path');
const { test, prepare, settle, shot, openDashboard, NOW, DESKTOP } = require('./helpers/manual-shot-kit');
const { mockMedia } = require('./helpers/media-mock');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** Settings that differ from the defaults, three on Behavior General and two on Privacy and sync. */
function changedData(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, { ...readJSON(file), lockLayout: true, openInNewTab: false, rememberScrollPosition: false, showSiteNews: false });
}

/** Three stored backups, each with its age in its name. */
function backupsData(dir) {
    const folder = path.join(dir, 'auto-backups');
    const names = fs.readdirSync(folder).filter((n) => n.endsWith('.zip'));
    const source = path.join(folder, names[0]);
    const keep = fs.readFileSync(source);
    names.forEach((n) => fs.rmSync(path.join(folder, n)));
    const stamp = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, (c) => (c === '-' ? '-' : '')).replace(/^(\d{4}-\d{2}-\d{2})T(\d{6})Z$/, '$1T$2Z');
    [1, 3, 8].forEach((days) => {
        const at = new Date(NOW.getTime() - days * 86_400_000);
        const file = path.join(folder, `nextdash-auto-backup-${stamp(at)}.zip`);
        fs.writeFileSync(file, keep);
        fs.utimesSync(file, at, at);
    });
}

/** A page of widgets: a Clock with Tokyo, a Countdown and a Jellyfin tile. */
function widgetsData(dir) {
    const pagesFile = path.join(dir, 'pages.json');
    const pages = readJSON(pagesFile);
    if (!(pages.order || []).includes(4)) pages.order = [...(pages.order || []), 4];
    writeJSON(pagesFile, pages);
    const widgets = [
        { id: 'w_e0000000001', type: 'clock', title: 'Time', config: { look: 'list', zones: ['Tokyo=Asia/Tokyo'], showDate: true } },
        { id: 'w_e0000000002', type: 'countdown', title: 'Winter holiday', config: { date: '2026-12-19' } },
        { id: 'w_e0000000003', type: 'jellyfin', config: { server: 'http://jellyfin.lab.example:8096' } },
    ];
    writeJSON(path.join(dir, 'bookmarks-4.json'), {
        page: { id: 4, name: 'Overview' },
        categories: [],
        widgets,
        blockOrder: widgets.map((w) => w.id),
        bookmarks: [],
    });
}

test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.waitForTimeout(800);
    await settle(page);
}
const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

test.describe('config', () => {
    test('find settings, layout', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'overview');
        await page.keyboard.press('Control+Shift+K');
        const input = page.locator('input[type="search"]:focus, input:focus').first();
        await input.waitFor();
        await page.keyboard.type('layout', { delay: 60 });
        await page.locator('.config-settings-jump-result', { hasText: 'earlier layout' }).first().waitFor();
        // Pacing for the capture, not a condition: the list finishes drawing.
        await page.waitForTimeout(600);
        await shot(page, 'config/v125-find-action.jpg');
    });

    test.describe('changed', () => {
        test.use({ dataTweak: { run: changedData } });
        test('only changed', async ({ page }) => {
            await prepare(page);
            await openConfig(page, 'behavior');
            await page.locator('[data-config-action="toggle-changed"]').click();
            await page.locator('.config-filter-elsewhere').waitFor();
            await page.waitForTimeout(600);
            await shot(page, 'settings/shot-4.jpg');
        });
    });
});

test.describe('data', () => {
    test('import cards', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'data-backups');
        await subtab(page, 'Backups').click();
        const group = page.locator('.config-db-group', { hasText: 'Bring things in' });
        await group.waitFor();
        await group.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(800);
        await shot(page, 'data/v125-import.jpg');
    });

    test.describe('three backups', () => {
        test.use({ dataTweak: { run: backupsData } });
        test('stored backups', async ({ page }) => {
            await prepare(page);
            await openConfig(page, 'data-backups');
            await subtab(page, 'Backups').click();
            await page.locator('#config-backup-list .config-db-row, #config-backup-list [data-backup-name], #config-backup-list > *').first().waitFor();
            const title = page.locator('.config-db-stored-title');
            await title.evaluate((el) => el.scrollIntoView({ block: 'start' }));
            await page.waitForTimeout(800);
            await shot(page, 'backups/shot-2.jpg');
        });
    });
});

test.describe('find', () => {
    test('sum', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.keyboard.type('15% of 240', { delay: 60 });
        await page.locator('#search-matches .search-match').first().filter({ hasText: '36' }).waitFor();
        await page.waitForTimeout(600);
        await shot(page, 'find/v125-sum.jpg');
    });

    test('commands', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press(':');
        const group = page.locator('#shortcut-search').getByText('Search & navigate').first();
        await group.waitFor();
        await group.click();
        await page.locator('#shortcut-search').getByText(':unsorted').first().waitFor();
        await page.waitForTimeout(600);
        await shot(page, 'find/v125-commands.jpg');
    });
});

test.describe('themes', () => {
    async function openStudio(page) {
        await openDashboard(page);
        await page.keyboard.press('Shift+A');
        await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
        await page.locator('#look-studio-tab-backdrop').click();
        await page.locator('[data-look-studio] [data-backdrop-panel]').first().waitFor();
        await page.waitForTimeout(1_200);
    }
    async function choosePick(page) {
        await page.locator('[data-look-studio] [data-backdrop-mode="pick"]').first().click();
        await page.locator('[data-look-studio] [data-backdrop-grid] .config-backdrop-thumb').first().waitFor();
        await page.waitForTimeout(1_200);
    }
    test('picker', async ({ page }) => {
        await prepare(page);
        await openStudio(page);
        await choosePick(page);
        await shot(page, 'themes/v125-picker.jpg');
    });
    test('picker search', async ({ page }) => {
        await prepare(page);
        await openStudio(page);
        await choosePick(page);
        await page.locator('[data-backdrop-all-toggle]').first().click();
        const search = page.locator('[data-backdrop-search]').first();
        await search.waitFor();
        await search.fill('glow');
        await page.locator('[data-backdrop-all] .config-backdrop-thumb').first().waitFor();
        // The results stand under the search field: bring it to the top of the panel.
        await search.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(1_200);
        await shot(page, 'themes/v125-picker-search.jpg');
    });
    test('studio', async ({ page }) => {
        await prepare(page);
        await openStudio(page);
        await shot(page, 'themes/v125-studio.jpg');
    });
});

test.describe('widgets', () => {
    test.use({ dataTweak: { run: widgetsData } });
    test('time', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('4');
        await page.locator('.dashboard-widget[data-widget-id="w_e0000000001"]').waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(1_200);
        await shot(page, 'widgets/v125-time.jpg');
    });
    test('menu', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('4');
        const tile = page.locator('.dashboard-widget[data-widget-id="w_e0000000003"]');
        await tile.waitFor({ state: 'visible', timeout: 45_000 });
        await page.waitForTimeout(1_200);
        await tile.click({ button: 'right', position: { x: 200, y: 18 } });
        await page.getByText('Refresh now').first().waitFor();
        await page.waitForTimeout(400);
        await shot(page, 'widgets/v125-menu.jpg');
    });
    test('picker uptime', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'widgets');
        await page.locator('[data-config-action="add-widget"], button:has-text("Add a widget")').first().click();
        const option = page.locator('[data-widget-option="uptime"]');
        await option.waitFor();
        await option.click();
        await page.waitForTimeout(1_000);
        await shot(page, 'widgets/shot-2.jpg');
    });
});
