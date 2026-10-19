// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * What a fresh install does with the example links, and the bundled templates
 * the import dialog offers. The choice itself ("Keep the examples", "Start
 * empty") is in the start guide's modal (start-guide.spec.js); these are the
 * parts around it.
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

test('a main page somebody changed gets the steps but not the choice about the examples', async ({ page, request }) => {
    await freshInstall(page, request);
    await page.evaluate(async () => {
        await nextDashFetch('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 1, bookmark: { name: 'Mine', url: 'https://example.com/', category: 'search', tags: [] } }),
        });
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page.locator('[data-start-guide-bar]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-start-guide-open]').click();
    await expect(page.locator('[data-start-guide-modal]')).toBeVisible();
    await expect(page.locator('[data-sg-step]').first()).toBeVisible();
    await expect(page.locator('[data-sg-keep]')).toHaveCount(0);
    await expect(page.locator('[data-sg-empty]')).toHaveCount(0);
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
