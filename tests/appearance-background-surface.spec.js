// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Appearance → Background and Surface, and the category header on Rows.
 *
 * Behaviour only, through the controls a reader uses: choose, see it on the
 * page, reload, and find it still there. How a backdrop or a header looks is
 * not asserted -- a pixel test would pin a colour and say nothing about
 * whether the choice reached the page.
 *
 * The store is shared with the other specs on this server, so each test puts
 * back what it moved.
 */
async function openTab(page, tab) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
    await page.click(`[data-appearance-tab="${tab}"]`);
}

async function reloadDashboard(page) {
    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
}

/** The bookmark grid itself: config reopens where it was left after a reload. */
async function showGrid(page) {
    // The header's own link back, as a reader would take it.
    await page.locator('a[href="/"]').first().click();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
}

const stored = (page) => page.evaluate(async () => {
    const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    return (await api('/api/settings')).json();
});

const rootVar = (page, name) => page.evaluate(
    (prop) => document.documentElement.style.getPropertyValue(prop).trim(), name);

test.describe('the Background and Surface tabs', () => {
    // One store behind every worker, and each save writes the whole settings
    // object: these move the same few settings and take turns.
    test.describe.configure({ mode: 'serial' });

    test('sit on the strip between Look and Grid', async ({ page }) => {
        await openTab(page, 'general');
        const tabs = await page.locator('[data-appearance-tab]').evaluateAll(
            (nodes) => nodes.map((n) => n.getAttribute('data-appearance-tab')));
        expect(tabs.slice(0, 4)).toEqual(['general', 'background', 'surface', 'layout']);
    });

    test('Look no longer carries what moved', async ({ page }) => {
        await openTab(page, 'general');
        await expect(page.locator('[data-appearance-select="themeDepth"]')).toHaveCount(0);
        await expect(page.locator('[data-appearance-bg]')).toHaveCount(0);
        await expect(page.locator('[data-appearance-select="inkGap"]')).toHaveCount(1);
    });

    test('a chosen backdrop reaches the page and survives a reload', async ({ page }) => {
        await openTab(page, 'background');

        await page.locator('[data-backdrop-mode="pick"]').click();
        await expect(page.locator('.config-backdrop-thumb')).toHaveCount(26);
        await page.locator('[data-backdrop-recipe="hexagons"]').click();
        await expect.poll(() => page.getAttribute('body', 'data-backdrop-recipe')).toBe('hexagons');

        await reloadDashboard(page);
        // Painted by the server for the first paint, not only by the client.
        expect(await page.getAttribute('body', 'data-backdrop-recipe')).toBe('hexagons');

        await openTab(page, 'background');
        await expect(page.locator('.config-backdrop-thumb.is-active')).toHaveAttribute('data-backdrop-recipe', 'hexagons');

        await page.locator('[data-backdrop-mode="follow"]').click();
        await expect.poll(() => page.getAttribute('body', 'data-backdrop-recipe')).toBe('');
        await page.locator('[data-backdrop-mode="off"]').click();
        await expect.poll(() => page.getAttribute('body', 'data-theme-backdrop')).toBe('off');
        await page.locator('[data-backdrop-mode="follow"]').click();
        await expect.poll(() => page.getAttribute('body', 'data-theme-backdrop')).toBe('on');
    });

    test('the sliders are live, saved, and there when the page comes back', async ({ page }) => {
        await openTab(page, 'background');

        await page.locator('[data-backdrop-tuning="strength"]').fill('0.5');
        await page.locator('[data-backdrop-tuning="blur"]').fill('10');
        await expect.poll(() => rootVar(page, '--bd-strength')).toBe('0.5');
        await expect.poll(() => rootVar(page, '--bd-blur')).toBe('10px');
        await expect.poll(async () => (await stored(page)).backdropTuning?.blur, { timeout: 5_000 }).toBe(10);

        await reloadDashboard(page);
        expect(await rootVar(page, '--bd-strength')).toBe('0.5');
        expect(await rootVar(page, '--bd-blur')).toBe('10px');
        // The content is not what is blurred.
        expect(await page.evaluate(() => getComputedStyle(document.body).filter)).toBe('none');

        await openTab(page, 'background');
        await page.locator('[data-backdrop-reset]').click();
        await expect.poll(() => rootVar(page, '--bd-blur')).toBe('0px');
        await expect.poll(async () => (await stored(page)).backdropTuning?.strength, { timeout: 5_000 }).toBe(1);
    });

    test('a new variant is saved and fetches the stylesheet again', async ({ page }) => {
        await openTab(page, 'background');

        const refetch = page.waitForRequest((req) => req.url().includes('/api/theme.css'));
        await page.locator('[data-backdrop-tuning="seed"]').fill('7');
        await refetch;
        await expect.poll(async () => (await stored(page)).backdropTuning?.seed, { timeout: 5_000 }).toBe(7);

        await page.locator('[data-backdrop-reset]').click();
        await expect.poll(async () => (await stored(page)).backdropTuning?.seed, { timeout: 5_000 }).toBe(0);
    });

    test('card glass is the theme’s own until it is changed, then saved per theme', async ({ page }) => {
        await openTab(page, 'surface');

        await page.locator('[data-appearance-select="themeDepth"]').selectOption('glass');
        await expect.poll(() => page.getAttribute('body', 'data-depth')).toBe('glass');
        await expect(page.locator('[data-glass-depth-hint]')).toHaveCount(0);

        await page.locator('[data-glass-mode="own"]').click();
        // The choice repaints the tab when its save comes back, and a slider
        // moved before that is a slider that is then replaced.
        await expect.poll(async () => Object.values((await stored(page)).themeSurfacePrefs || {})
            .some((pref) => typeof pref.alpha === 'number'), { timeout: 5_000 }).toBe(true);
        await expect(page.locator('[data-glass-mode="own"]')).toHaveClass(/is-active/);
        await page.waitForTimeout(400);
        await page.locator('[data-glass-range="alpha"]').fill('0.4');
        await expect.poll(() => rootVar(page, '--theme-surface-alpha')).toBe('0.4');
        await expect(page.locator('[data-glass-contrast]')).not.toBeEmpty();
        // Saved before the page is left, or the reload below races the write.
        await expect.poll(async () => Object.values((await stored(page)).themeSurfacePrefs || {})
            .some((pref) => pref.alpha === 0.4), { timeout: 5_000 }).toBe(true);

        await reloadDashboard(page);
        expect(await rootVar(page, '--theme-surface-alpha')).toBe('0.4');

        await openTab(page, 'surface');
        await page.locator('[data-glass-mode="follow"]').click();
        await expect.poll(() => rootVar(page, '--theme-surface-alpha')).toBe('');
        await page.locator('[data-appearance-action="reset-theme-surfaces"]').click();
    });

    test('the category header: a style, a count, and both come back', async ({ page }) => {
        await openTab(page, 'display');

        await page.locator('[data-behavior-field="categoryHeaderStyle"]').selectOption('underlined');
        await page.locator('[data-behavior-field="showCategoryCount"]').check();
        await expect.poll(() => page.getAttribute('body', 'data-cat-head')).toBe('underlined');
        await expect.poll(() => page.getAttribute('body', 'data-cat-count')).toBe('on');

        await expect.poll(async () => (await stored(page)).categoryHeaderStyle, { timeout: 5_000 }).toBe('underlined');
        await reloadDashboard(page);
        expect(await page.getAttribute('body', 'data-cat-head')).toBe('underlined');
        expect(await page.getAttribute('body', 'data-cat-count')).toBe('on');
        await showGrid(page);
        const count = page.locator('.category:not([data-smart-collection="true"]) .category-title-count').first();
        await expect(count).toBeVisible();
        await expect(count).toHaveText(/^\d+$/);

        await openTab(page, 'display');
        await page.locator('[data-behavior-field="categoryHeaderStyle"]').selectOption('theme');
        await page.locator('[data-behavior-field="showCategoryCount"]').uncheck();
        await expect.poll(() => page.getAttribute('body', 'data-cat-head')).toBe('theme');
        await expect.poll(() => page.getAttribute('body', 'data-cat-count')).toBe('off');
    });

    test('hiding the icon takes it off every header', async ({ page }) => {
        await openTab(page, 'display');
        await page.locator('[data-behavior-field="showCategoryIcon"]').uncheck();
        await expect.poll(() => page.getAttribute('body', 'data-cat-icon')).toBe('off');
        await expect.poll(async () => (await stored(page)).showCategoryIcon, { timeout: 5_000 }).toBe(false);
        await reloadDashboard(page);
        await showGrid(page);
        const shown = await page.evaluate(() => [...document.querySelectorAll('.dashboard-grid .category-title-icon')]
            .map((el) => getComputedStyle(el).display));
        expect(shown.length, 'no category icons on the page to check').toBeGreaterThan(0);
        expect(shown.every((display) => display === 'none')).toBe(true);

        await openTab(page, 'display');
        await page.locator('[data-behavior-field="showCategoryIcon"]').check();
        await expect.poll(() => page.getAttribute('body', 'data-cat-icon')).toBe('on');
    });
});
