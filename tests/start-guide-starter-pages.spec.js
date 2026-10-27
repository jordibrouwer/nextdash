// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The start guide's extras: ready-made pages, the Unraid and second-page
 * steps, and the language hint. The routes are mocked, so no real data is
 * written by the template calls.
 */

const BUNDLED = (extra = {}) => ({
    templates: [
        { id: 'homelab', name: 'Homelab', icon: 'server', links: 9, services: ['Home Assistant', 'Proxmox', 'Pi-hole', 'Router'], variables: [] },
        { id: 'media-server', name: 'Media server', icon: 'film', links: 8, services: ['Jellyfin', 'Sonarr'], variables: [] },
        { id: 'developer', name: 'Developer', icon: 'code', links: 7, services: ['GitHub', 'Grafana'], variables: [] },
    ],
    replacesMain: true,
    platform: '',
    ...extra,
});

async function setup(page, request, { bundled = BUNDLED(), language, navLanguage } = {}) {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    expect((await request.post('/api/settings', {
        data: {
            onboardingCompleted: false,
            discoveryCardDone: true,
            ...(language ? { language } : {}),
            quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: '' },
        },
        headers,
    })).ok()).toBe(true);
    if (navLanguage) {
        await page.addInitScript((lang) => {
            Object.defineProperty(Navigator.prototype, 'language', { get: () => lang, configurable: true });
        }, navLanguage);
    }
    if (bundled) {
        await page.route('**/api/page-templates/bundled', (route) => route.fulfill({ json: bundled }));
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page.locator('[data-start-guide-bar]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-start-guide-open]').click();
    await expect(page.locator('[data-start-guide-modal]')).toBeVisible();
}

const modal = (page) => page.locator('[data-start-guide-modal]');

test.afterEach(async ({ request }) => {
    // The language test changes a setting: put the install back.
    await request.post('/api/settings', { data: { language: 'en' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
});

test.describe('ready-made pages', () => {
    test('the row lists the three templates with service chips, and says what happens to the examples', async ({ page, request }) => {
        await setup(page, request);
        const cards = modal(page).locator('[data-sg-starter]');
        await expect(cards).toHaveCount(3);
        await expect(cards.nth(0)).toContainText('Homelab');
        await expect(cards.nth(0)).toContainText('Proxmox');
        await expect(cards.nth(0)).not.toContainText('Router');
        await expect(modal(page).locator('[data-sg-starter-sub]')).toHaveText('Replaces the example links.');
        await expect(modal(page).locator('[data-sg-starter-form]')).toBeHidden();
    });

    test('says "Added as a new page" when the main page is no longer the starter', async ({ page, request }) => {
        await setup(page, request, { bundled: BUNDLED({ replacesMain: false }) });
        await expect(modal(page).locator('[data-sg-starter-sub]')).toHaveText('Added as a new page.');
    });

    test('picking a card reveals the address field; Create posts the id and the server', async ({ page, request }) => {
        let body = null;
        await page.route('**/api/onboarding/template', (route) => {
            body = route.request().postDataJSON();
            return route.fulfill({ json: { result: 'ok', replaced: true } });
        });
        await setup(page, request);
        await modal(page).locator('[data-sg-starter="media-server"]').click();
        await expect(modal(page).locator('[data-sg-starter="media-server"]')).toHaveAttribute('aria-pressed', 'true');
        const field = modal(page).getByLabel('Your server address');
        await expect(field).toBeVisible();
        await expect(field).toHaveAttribute('placeholder', '192.168.1.10');
        await field.fill('nas.local');
        await modal(page).getByRole('button', { name: 'Create page' }).click();
        await expect.poll(() => body).toEqual({ id: 'media-server', server: 'nas.local' });
        await expect(modal(page)).toHaveCount(0);
        await expect.poll(async () => (await (await request.get('/api/settings')).json()).quickStart.templatePicked).toBe('empty');
    });

    test('a 422 shows its message inline and keeps the modal open', async ({ page, request }) => {
        await page.route('**/api/onboarding/template', (route) =>
            route.fulfill({ status: 422, json: { error: 'That address does not look right' } }));
        await setup(page, request);
        await modal(page).locator('[data-sg-starter="homelab"]').click();
        await modal(page).getByLabel('Your server address').fill('not an address!');
        await modal(page).getByRole('button', { name: 'Create page' }).click();
        const alert = modal(page).locator('[data-sg-starter-error]');
        await expect(alert).toHaveText('That address does not look right');
        await expect(alert).toHaveAttribute('role', 'alert');
        await expect(modal(page)).toBeVisible();
    });

    test('an empty or failed list renders no row', async ({ page, request }) => {
        await setup(page, request, { bundled: BUNDLED({ templates: [] }) });
        await expect(modal(page).locator('[data-sg-starters]')).toHaveCount(0);
        await expect(modal(page).locator('[data-sg-keep]')).toBeVisible();
    });
});

test.describe('steps', () => {
    test('a second-page step always exists; the Unraid step only on Unraid', async ({ page, request }) => {
        await setup(page, request);
        await modal(page).locator('[data-sg-more]').click();
        await expect(modal(page).locator('[data-sg-step="secondPage"]')).toContainText('Add a second page');
        await expect(modal(page).locator('[data-sg-step="unraid"]')).toHaveCount(0);
    });

    test('platform unraid adds the Unraid step, which opens its settings', async ({ page, request }) => {
        await setup(page, request, { bundled: BUNDLED({ platform: 'unraid' }) });
        await modal(page).locator('[data-sg-more]').click();
        await expect(modal(page).locator('[data-sg-step="unraid"]')).toContainText('Connect your Unraid server');
        await expect(modal(page).locator('[data-sg-progress]')).toContainText('of 11 done');
        await modal(page).locator('[data-sg-step="unraid"] button').click();
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#config/unraid');
    });
});

test.describe('language hint', () => {
    test('offers the browser language once, and Switch changes the setting', async ({ page, request }) => {
        await setup(page, request, { navLanguage: 'nl-NL' });
        const hint = modal(page).locator('[data-sg-lang-hint]');
        await expect(hint).toContainText('Nederlands detected');
        await hint.getByRole('button', { name: 'Switch' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.language)).toBe('nl');
        await expect(modal(page).locator('[data-sg-lang-hint]')).toHaveCount(0);
    });

    test('touching the dropdown withdraws the hint', async ({ page, request }) => {
        await setup(page, request, { navLanguage: 'nl-NL' });
        await expect(modal(page).locator('[data-sg-lang-hint]')).toBeVisible();
        await modal(page).locator('[data-sg-language]').selectOption('de');
        await expect(modal(page).locator('[data-sg-lang-hint]')).toHaveCount(0);
    });

    test('no hint when the language already matches or is not offered', async ({ page, request }) => {
        await setup(page, request, { navLanguage: 'en-US' });
        await expect(modal(page).locator('[data-sg-lang-hint]')).toHaveCount(0);
    });

    test('no hint for a language nextDash does not have', async ({ page, request }) => {
        await setup(page, request, { navLanguage: 'ja-JP' });
        await expect(modal(page).locator('[data-sg-lang-hint]')).toHaveCount(0);
    });
});
