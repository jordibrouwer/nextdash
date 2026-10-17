// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The first-start card: "What do you want?" above main on a fresh install,
 * before the quick-start checklist: keep the example links or start empty. fixtures.js answers it with Keep for every
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

test('Start with an empty page clears the example links, then the checklist asks for a first bookmark', async ({ page, request }) => {
    await freshInstall(page, request);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('what do you want?');
    await expect(page.locator('.quickstart-checklist')).toHaveCount(0);

    await card(page).getByRole('button', { name: /Start with an empty page/ }).click();
    await expect(card(page)).toHaveCount(0);
    expect(await mainLinks(page)).toEqual({});
    await expect(page.locator('#dashboard-layout .bookmark-link')).toHaveCount(0);
    await expect(page.locator('.quickstart-checklist')).toContainText('Add your first bookmark');

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(card(page)).toHaveCount(0);
});

test('Keep these links leaves main alone and the card does not come back', async ({ page, request }) => {
    await freshInstall(page, request);
    await card(page).getByRole('button', { name: /Keep these example links/ }).click();
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
    await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();
    // The card must never appear, so give a late render time to show it.
    await page.waitForTimeout(1500);
    await expect(card(page)).toHaveCount(0);
});

test('a main page somebody changed gets no card', async ({ page, request }) => {
    await freshInstall(page, request);
    await page.evaluate(async () => {
        await nextDashFetch('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 1, bookmark: { name: 'Mine', url: 'https://example.com/', category: 'search', tags: [] } }),
        });
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // A check that the card does NOT come back after a change: give it the time it would take to show.
    await page.waitForTimeout(1500);
    await expect(card(page)).toHaveCount(0);
    expect((await mainLinks(page)).Mine).toBe('https://example.com/');
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

/**
 * The card and the Shift+F bar both sit above the grid, and the card used to
 * win the spot right above it: it re-places itself every 500ms with
 * `grid.before(card)`, so a filter bar opened under it was overtaken half a
 * second later and ended up above the card, away from the rows it filters.
 * The bars belong to the grid; the card goes above all of them.
 */
test('the filter bar stays between the card and the grid', async ({ page, request }) => {
    await freshInstall(page, request);
    await expect(card(page)).toBeVisible();

    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+F');
    await expect(page.locator('#grid-filter-bar')).toBeVisible();
    // Two of the card's 500ms checks, so a move would have happened.
    await page.waitForTimeout(1200);

    const order = await page.evaluate(() => {
        const bar = document.getElementById('grid-filter-bar');
        const grid = document.getElementById('dashboard-layout');
        const cardEl = document.querySelector('.first-start-card');
        return {
            barRightAboveGrid: bar?.nextElementSibling === grid,
            cardAboveBar: Boolean(cardEl && bar
                && (cardEl.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING)),
        };
    });
    expect(order).toEqual({ barRightAboveGrid: true, cardAboveBar: true });
});
