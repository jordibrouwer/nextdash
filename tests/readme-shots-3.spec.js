// @ts-check
/*
 * README pictures, batch 3: Config panels, theme studio, Unraid.
 * Full frames at 1920x1200, each in the theme its caption names.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=2 \
 *     npx playwright test tests/readme-shots-3.spec.js
 */
const path = require('path');
const {
    test,
    prepare,
    settle,
    shot,
    openDashboard,
    readJSON,
    writeJSON,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: { width: 1920, height: 1200 }, reducedMotion: 'reduce' });
test.setTimeout(120_000);

/** Config, by the gear in the header, then a section on its rail. */
async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.locator('.config-view').waitFor();
    await settle(page);
}
const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/** The seven Unraid widgets on Homelab, beside its bookmarks. */
const unraidOnHomelab = {
    run(dir) {
        const file = path.join(dir, 'bookmarks-2.json');
        const page = readJSON(file);
        const types = ['unraid', 'unraidArray', 'unraidParity', 'unraidShares', 'unraidVms', 'unraidUps', 'unraidNotifications'];
        const widgets = types.map((type, i) => ({ id: `w_u0000000000${i + 1}`, type }));
        page.widgets = widgets;
        page.blockOrder = ['platforms', widgets[0].id, widgets[2].id, 'network', widgets[1].id, widgets[3].id, widgets[4].id, 'home', 'community', widgets[5].id, widgets[6].id, 'makers'];
        writeJSON(file, page);
    },
};

async function unraidDashboard(page, name) {
    await prepare(page);
    await openDashboard(page, '#2');
    await page.getByText('as of', { exact: false }).first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-widget-type^="unraid"] , .widget-card').length > 0).catch(() => {});
    await settle(page);
    await shot(page, name);
}

test.describe('appearance', () => {
    test.use({ shotTheme: 'sea-glass-light' });
    test('config appearance', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'appearance');
        await subtab(page, 'Theme').click();
        await page.locator('[data-appearance-select], .config-panel').first().waitFor();
        await settle(page);
        await shot(page, 'readme/nextdash-config-appearance.jpg');
    });
});

test.describe('statistics', () => {
    test.use({ shotTheme: 'copper-circuit-dark' });
    test('config statistics', async ({ page }) => {
        await prepare(page);
        await openConfig(page, 'stats');
        await page.getByText('Needs attention').first().waitFor();
        await page.getByText('Cleanup score').first().waitFor();
        await settle(page);
        await shot(page, 'readme/nextdash-config-statistics.jpg');
    });
});

test.describe('studio', () => {
    test.use({ shotTheme: 'mulberry-silk-dark' });
    test('theme studio', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('Shift+A');
        await page.locator('[data-look-studio]').waitFor({ state: 'visible' });
        await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
        await settle(page);
        await shot(page, 'readme/nextdash-themes.jpg');
    });
});

test.describe('unraid black', () => {
    test.use({ shotTheme: 'unraid-black-dark', dataTweak: unraidOnHomelab });
    test('unraid black', async ({ page }) => unraidDashboard(page, 'readme/nextdash-unraid-black.jpg'));
});
test.describe('unraid azure', () => {
    test.use({ shotTheme: 'unraid-azure-light', dataTweak: unraidOnHomelab });
    test('unraid azure', async ({ page }) => unraidDashboard(page, 'readme/nextdash-unraid-azure.jpg'));
});
test.describe('unraid dashboard', () => {
    test.use({ dataTweak: unraidOnHomelab });
    test('unraid dashboard', async ({ page }) => unraidDashboard(page, 'readme/nextdash-unraid-dashboard.jpg'));
});

test.describe('unraid config', () => {
    test.use({ shotTheme: 'nordic-frost-dark' });
    test('unraid config', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/unraid/settings', (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            return route.fulfill({ json: { server: { id: 'u_1', name: 'tower', baseUrl: 'http://tower.local', enabled: true, insecureTls: true, notify: true }, keySet: true, suggestedBaseUrl: '' } });
        });
        await page.route('**/api/unraid/test', (route) => route.fulfill({ json: {
            ok: true, info: { name: 'tower', unraid: '7.2.1', api: '4.37.5', roles: ['VIEWER'] },
            areas: { array: 'ok', parity: 'ok', shares: 'ok', vms: 'ok', ups: 'ok', notifications: 'ok' },
        } }));
        await openConfig(page, 'unraid');
        await page.locator('[data-unraid-field="baseUrl"]').waitFor();
        await page.waitForFunction(() => window.dashboardInstance?._configRefreshReady === true);
        await page.locator('[data-unraid-test]').click();
        await page.getByText('Array: yes').waitFor();
        await settle(page);
        await shot(page, 'readme/nextdash-unraid-config.jpg');
    });
});
