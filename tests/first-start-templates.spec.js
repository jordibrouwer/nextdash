// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The first-start card: "What do you run?" above main on a fresh install,
 * before the quick-start checklist. fixtures.js answers it with Keep for every
 * other spec; these put the store back to a fresh install with the card
 * unanswered.
 */

async function freshInstall(page, request, { onboardingCompleted = false } = {}) {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    expect((await request.post('/api/settings', {
        data: { onboardingCompleted, quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: '' } },
        headers,
    })).ok()).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const card = (page) => page.locator('.first-start-card');

async function mainLinks(page) {
    return page.evaluate(async () => {
        const res = await fetch('/api/bookmarks?page=1');
        return Object.fromEntries((await res.json()).map((b) => [b.name, b.url]));
    });
}

test('a template on one address replaces the starter links, then the checklist names a service', async ({ page, request }) => {
    await freshInstall(page, request);
    await expect(card(page)).toBeVisible();
    await expect(page.locator('.quickstart-checklist')).toHaveCount(0);

    await card(page).getByRole('button', { name: /Media server/ }).click();
    await card(page).getByLabel('Where do these run?').fill('192.168.1.10');
    await card(page).getByRole('button', { name: /More/ }).click();
    await expect(card(page).getByLabel('Jellyfin', { exact: true })).toHaveValue('http://192.168.1.10:8096');
    await card(page).getByLabel('qBittorrent').fill('http://10.0.0.5:8081');
    // A field edited by hand stops following the server address.
    await card(page).getByLabel('Where do these run?').fill('nas.local');
    await expect(card(page).getByLabel('Sonarr')).toHaveValue('http://nas.local:8989');
    await expect(card(page).getByLabel('qBittorrent')).toHaveValue('http://10.0.0.5:8081');
    await expect(card(page)).toContainText('Replaces the starter links on this page.');
    await card(page).getByRole('button', { name: 'Set up the page' }).click();

    await expect(card(page)).toHaveCount(0);
    const links = await mainLinks(page);
    expect(links.Jellyfin).toBe('http://nas.local:8096/');
    expect(links.qBittorrent).toBe('http://10.0.0.5:8081/');
    expect(links.nextDash).toBe('https://nextdash.cc/');
    expect(links.YouTube).toBeUndefined();
    await expect(page).toHaveTitle(/Media server/);
    await expect(page.locator('.quickstart-checklist')).toContainText('Open Jellyfin from the dashboard');
    await expect(page.locator('.quickstart-checklist')).toContainText('Type j');
});

test('Keep these links leaves main alone and the card does not come back', async ({ page, request }) => {
    await freshInstall(page, request);
    await card(page).getByRole('button', { name: /Keep these links/ }).last().click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.quickstart-checklist')).toBeVisible();
    await expect(page.locator('.quickstart-checklist')).toContainText('Add your first bookmark');
    expect((await mainLinks(page)).YouTube).toBe('https://youtube.com');

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page.locator('.quickstart-checklist')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
});

test('an install that finished its first run never sees the card', async ({ page, request }) => {
    await freshInstall(page, request, { onboardingCompleted: true });
    await page.waitForTimeout(1500);
    await expect(card(page)).toHaveCount(0);
});

test('a changed main page gets the template as a new page', async ({ page, request }) => {
    await freshInstall(page, request);
    await page.evaluate(async () => {
        await nextDashFetch('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 1, bookmark: { name: 'Mine', url: 'https://example.com/', category: 'search', tags: [] } }),
        });
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await card(page).getByRole('button', { name: /Developer/ }).click();
    await expect(card(page)).toContainText('Adds a new page');
    await card(page).getByLabel('Where do these run?').fill('192.168.1.20');
    await card(page).getByRole('button', { name: 'Set up the page' }).click();
    await expect(card(page)).toHaveCount(0);
    expect((await mainLinks(page)).Mine).toBe('https://example.com/');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.currentPageId)).not.toBe(1);
    const gitea = await page.evaluate(async () => {
        const id = window.dashboardInstance.currentPageId;
        const rows = await (await fetch(`/api/bookmarks?page=${id}`)).json();
        return rows.find((b) => b.name === 'Gitea')?.url;
    });
    expect(gitea).toBe('http://192.168.1.20:3000/');
});

test('the dashboard tour names a service on the page', async ({ page, request }) => {
    await freshInstall(page, request);
    await card(page).getByRole('button', { name: /Media server/ }).click();
    await card(page).getByLabel('Where do these run?').fill('192.168.1.10');
    await card(page).getByRole('button', { name: 'Set up the page' }).click();
    await expect(card(page)).toHaveCount(0);
    await page.evaluate(() => window.dashboardInstance.promos.openDashboardTour());
    const tour = page.locator('#app-modal.show .dashboard-tutorial-modal');
    await expect(tour).toBeVisible();
    await expect.poll(async () => {
        const text = await tour.innerText();
        if (/type j for Jellyfin/.test(text)) return 'found';
        await page.locator('.modal-actions .modal-button').first().click();
        return text.slice(0, 40);
    }, { timeout: 15_000 }).toBe('found');
});

test('the import dialog offers the bundled templates and fills them from one address', async ({ page, request }) => {
    await freshInstall(page, request, { onboardingCompleted: true });
    await page.evaluate(() => { void window.dashboardInstance.config.openPageTemplate('import'); });
    const dialog = page.locator('.config-form-dialog');
    await dialog.getByRole('button', { name: 'Homelab' }).click();
    await expect(dialog.locator('.config-tpl-summary')).toContainText('Homelab');
    await dialog.getByLabel('Where do these run?').fill('10.0.0.2');
    await expect(dialog.locator('[data-tpl-value="homeassistant"]')).toHaveValue('http://10.0.0.2:8123');
    await expect(dialog.locator('[data-tpl-value="router"]')).toHaveValue('http://192.168.1.1');
    await dialog.getByRole('button', { name: 'Create page' }).click();
    await expect(dialog).toHaveCount(0);
    const ha = await page.evaluate(async () => {
        const pages = await (await fetch('/api/pages')).json();
        const homelab = pages.find((p) => p.name === 'Homelab');
        const rows = await (await fetch(`/api/bookmarks?page=${homelab.id}`)).json();
        return rows.find((b) => b.name === 'Home Assistant')?.url;
    });
    expect(ha).toBe('http://10.0.0.2:8123/');
});
