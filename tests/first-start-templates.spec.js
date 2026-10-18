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

// The card sits on the same surface as the categories under it and sets its
// title the way a category title is set, from the theme's own label settings.
test('the card is a pane like the categories, and its title takes the theme label', async ({ page, request }) => {
    await freshInstall(page, request);
    await expect(card(page)).toBeVisible();

    const read = () => page.evaluate(() => {
        const el = document.querySelector('.first-start-card');
        const cs = getComputedStyle(el);
        const title = getComputedStyle(el.querySelector('.first-start-title'));
        const m = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
        return {
            blur: cs.backdropFilter, alpha: m ? parseFloat(m[1]) : 1,
            weight: title.fontWeight, transform: title.textTransform,
            tab: getComputedStyle(el.querySelector('.first-start-head')).backgroundSize,
            tile: getComputedStyle(el.querySelector('.first-start-tile')).backgroundColor,
        };
    });

    await page.evaluate(() => window.ThemeLoader.applyCatSurface('glass'));
    const glass = await read();
    expect(glass.blur).not.toBe('none');
    expect(glass.alpha).toBeLessThan(1);
    // The accent is a short tab under the title, not a bar across the card.
    expect(parseFloat(glass.tab)).toBeLessThan(80);
    // The tiles are light glass chips, not solid blocks.
    expect(glass.tile).not.toMatch(/rgb\(\d+, \d+, \d+\)$/);

    // The title is set by --theme-label-*.
    await page.evaluate(() => {
        document.documentElement.style.setProperty('--theme-label-weight', '800');
        document.documentElement.style.setProperty('--theme-label-transform', 'uppercase');
    });
    const labelled = await read();
    expect(labelled.weight).toBe('800');
    expect(labelled.transform).toBe('uppercase');

    await page.evaluate(() => window.ThemeLoader.applyCatSurface('card'));
    const solid = await read();
    expect(solid.blur).toBe('none');
    expect(solid.alpha).toBe(1);
});

// Four answers side by side, centred: keep, empty, the manual first, the theme studio.
test('the card offers four answers in one centred row', async ({ page, request }) => {
    await freshInstall(page, request);
    await expect(card(page)).toBeVisible();
    const tiles = card(page).locator('.first-start-tile');
    await expect(tiles).toHaveCount(4);
    await expect(card(page).getByRole('button', { name: /Show me the manual first/ })).toBeVisible();
    await expect(card(page).getByRole('button', { name: /Open the theme studio/ })).toBeVisible();

    const geo = await page.evaluate(() => {
        const el = document.querySelector('.first-start-card');
        const box = el.getBoundingClientRect();
        const rects = [...el.querySelectorAll('.first-start-tile')].map((t) => t.getBoundingClientRect());
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        return {
            tops: [...new Set(rects.map((r) => Math.round(r.top)))].length,
            offCentre: Math.abs((left + right) / 2 - (box.left + box.right) / 2),
            widths: rects.map((r) => Math.round(r.width)),
            clipped: [...el.querySelectorAll('.first-start-tile-name, .first-start-tile-services')].some((n) => n.scrollWidth > n.clientWidth + 1),
        };
    });
    expect(geo.tops, 'all four sit in one row').toBe(1);
    expect(geo.offCentre).toBeLessThanOrEqual(2);
    expect(geo.clipped, 'no text is cut off').toBe(false);
});

test('Show me the manual first opens the docs in a new window and leaves the card', async ({ page, request, context }) => {
    await context.route('https://nextdash.cc/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>docs</title>' }));
    await freshInstall(page, request);
    const popup = context.waitForEvent('page');
    await card(page).getByRole('button', { name: /Show me the manual first/ }).click();
    const opened = await popup;
    expect(opened.url()).toMatch(/^https:\/\/nextdash\.cc\/docs/);
    await expect(card(page)).toBeVisible();
});

test('Open the theme studio opens it, says what to try, and leaves the card', async ({ page, request }) => {
    await freshInstall(page, request);
    const studio = card(page).getByRole('button', { name: /Open the theme studio/ });
    await expect(studio).toContainText(/surface/i);
    await expect(studio).toContainText(/Shift\+A/);
    await studio.click();
    await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toHaveCount(1);
});
