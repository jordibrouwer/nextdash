// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen } = require('./e2e-helpers');

/*
 * App icons in the Containers view: one ahead of each name, and a pencil in
 * the drawer to choose another, show the letter, or go back to automatic.
 *
 * Docker is mocked; the icon and the override are what the server would put
 * on each row. The override is read from the real settings on every list
 * request, so a choice the drawer saves comes back after a reload exactly as
 * it would from the server.
 */

const SONARR_ICON = {
    set: 'dashboard-icons', name: 'sonarr', label: 'Sonarr',
    base: '/data/icon-sets/dashboard-icons/sonarr.svg',
    light: '/data/icon-sets/dashboard-icons/sonarr.svg',
    dark: '/data/icon-sets/dashboard-icons/sonarr-dark.svg',
};

async function openContainers(page, hash = '#docker') {
    await markWhatsNewSeen(page);
    const state = await mockDocker(page);
    // Registered after the mock, so it answers the list instead of it.
    await page.route('**/api/docker/containers', async (route) => {
        const res = await page.request.get('/api/settings');
        const overrides = (await res.json()).dockerContainerIcons || {};
        const containers = state.containers.map((c) => {
            const row = { ...c };
            if (overrides[c.name]) row.iconOverride = overrides[c.name];
            else if (c.name === 'sonarr') row.icon = SONARR_ICON;
            return row;
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, containers }) });
    });
    await page.goto(`/${hash}`);
    await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible();
    return state;
}

async function resetOverrides(page) {
    await page.goto('/');
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dockerContainerIcons: {} }),
        });
    });
}

async function savedOverrides(page) {
    const res = await page.request.get('/api/settings');
    return (await res.json()).dockerContainerIcons || {};
}

async function openIconMenu(page) {
    const drawer = page.locator('[data-docker-drawer]');
    await drawer.locator('[data-docker-icon-menu]').click();
    return drawer;
}

test.describe('container icons', () => {
    test.beforeEach(async ({ page }) => {
        await resetOverrides(page);
    });

    test('a matched container shows its app icon, another its letter', async ({ page }) => {
        await openContainers(page);
        await expect(page.locator('[data-docker-row="sonarr"] img[data-docker-icon="set"]'))
            .toHaveAttribute('src', /\/data\/icon-sets\/dashboard-icons\/sonarr/);
        await expect(page.locator('[data-docker-row="bazarr"] [data-docker-icon="letter"]')).toHaveText('B');
    });

    test('the icon follows the theme: the light variant on dark, the dark variant on light', async ({ page }) => {
        await openContainers(page);
        const icon = page.locator('[data-docker-row="sonarr"] img[data-docker-icon="set"]');
        await page.evaluate(() => window.ThemeLoader.applyTheme('tarnished-brass-light'));
        await expect(icon).toHaveAttribute('src', '/data/icon-sets/dashboard-icons/sonarr-dark.svg');
        await page.evaluate(() => window.ThemeLoader.applyTheme('tarnished-brass-dark'));
        await expect(icon).toHaveAttribute('src', '/data/icon-sets/dashboard-icons/sonarr.svg');
    });

    test('Use letter in the drawer sticks after a reload; Automatic brings the icon back', async ({ page }) => {
        await openContainers(page, '#docker/sonarr');
        const drawer = await openIconMenu(page);
        await drawer.locator('[data-docker-icon-letter]').click();
        await expect.poll(() => savedOverrides(page)).toEqual({ sonarr: 'letter' });

        await page.reload();
        await expect(page.locator('[data-docker-row="sonarr"] [data-docker-icon="letter"]')).toHaveText('S');

        await page.goto('/#docker/sonarr');
        await openIconMenu(page);
        await page.locator('[data-docker-drawer] [data-docker-icon-auto]').click();
        await expect.poll(() => savedOverrides(page)).toEqual({});
        await expect(page.locator('[data-docker-row="sonarr"] img[data-docker-icon="set"]')).toBeVisible();
    });

    test('Choose app icon picks one with the keyboard and the row shows it', async ({ page }) => {
        await openContainers(page, '#docker/jellyfin');
        await openIconMenu(page);
        await page.locator('[data-docker-drawer] [data-docker-icon-choose]').click();
        const search = page.locator('[data-icon-set-popover]').getByRole('searchbox');
        await expect(search).toBeFocused();
        await search.fill('jellyfin');
        await expect(page.locator('[data-icon-set-popover] [role="option"]').first())
            .toHaveAttribute('data-icon-set-option', 'dashboard-icons/jellyfin');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');

        await expect.poll(() => savedOverrides(page)).toEqual({ jellyfin: expect.stringMatching(/^jellyfin(-\d+)?\.svg$/) });
        await expect(page.locator('[data-docker-row="jellyfin"] img[data-docker-icon="chosen"]'))
            .toHaveAttribute('src', /\/data\/icons\/jellyfin/);
    });
});
