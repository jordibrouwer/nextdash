// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady, setChip, openConfigPanel } = require('./e2e-helpers');

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

/** Open a Fine-tune fold by its header, the way a reader does; leaves an open one alone. */
async function openFine(page, id) {
    const head = page.locator(`[data-fine="${id}"] [data-fine-toggle]`);
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
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
        await openConfigPanel(page, 'Backdrop');

        await page.locator('[data-backdrop-mode="pick"]').click();
        await expect(page.locator('.config-backdrop-thumb')).toHaveCount(29);
        await page.locator('[data-backdrop-recipe="hexagons"]').click();
        await expect.poll(() => page.getAttribute('body', 'data-backdrop-recipe')).toBe('hexagons');

        await reloadDashboard(page);
        // Painted by the server for the first paint, not only by the client.
        expect(await page.getAttribute('body', 'data-backdrop-recipe')).toBe('hexagons');

        await openTab(page, 'background');
        // Opened by its header before the reload, and remembered.
        await expect(page.locator('[data-backdrop-mode="pick"]')).toBeVisible();
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
        await openConfigPanel(page, 'Backdrop');

        await openFine(page, 'backdrop');
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
        await openFine(page, 'backdrop');
        await page.locator('[data-backdrop-reset]').click();
        await expect.poll(() => rootVar(page, '--bd-blur')).toBe('0px');
        await expect.poll(async () => (await stored(page)).backdropTuning?.strength, { timeout: 5_000 }).toBe(1);
    });

    test('a new variant is saved and fetches the stylesheet again', async ({ page }) => {
        await openTab(page, 'background');
        await openConfigPanel(page, 'Backdrop');

        await openFine(page, 'backdrop');
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

        await openConfigPanel(page, 'Card glass');
        await page.locator('[data-glass-mode="own"]').click();
        // The choice repaints the tab when its save comes back, and a slider
        // moved before that is a slider that is then replaced.
        await expect.poll(async () => Object.values((await stored(page)).themeSurfacePrefs || {})
            .some((pref) => typeof pref.alpha === 'number'), { timeout: 5_000 }).toBe(true);
        await expect(page.locator('[data-glass-mode="own"]')).toHaveClass(/is-active/);
        // The repaint runs when the save promise settles, so wait for that.
        await page.waitForFunction(() => !window.dashboardInstance.config._settingsSavePromise);
        await openFine(page, 'glass');
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
        await openConfigPanel(page, page.locator('[data-appearance-action="reset-theme-surfaces"]'));
        await page.locator('[data-appearance-action="reset-theme-surfaces"]').click();
    });

    test('the category header: a style, a count, and both come back', async ({ page }) => {
        await openTab(page, 'display');
        await openConfigPanel(page, page.locator('[data-behavior-field="categoryHeaderStyle"]'));

        await page.locator('[data-behavior-field="categoryHeaderStyle"]').selectOption('underlined');
        await setChip(page.locator('[data-behavior-field="showCategoryCount"]'), true);
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
        await setChip(page.locator('[data-behavior-field="showCategoryCount"]'), false);
        // Follow the theme: its own header, which for Confetti is clean.
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-cat-head') === window.ThemeLoader.resolveCatHead('theme', document.body.getAttribute('data-theme')))).toBe(true);
        await expect.poll(() => page.getAttribute('body', 'data-cat-count')).toBe('off');
    });

});
