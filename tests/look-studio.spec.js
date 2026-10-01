// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The theme browser as a look studio: a panel docked beside the dashboard
 * with tabs for themes, backdrop, surface, headers and looks.
 *
 * Behaviour only, through the controls and keys a reader uses: everything
 * changes the page at once, nothing is stored until Apply, Cancel puts it all
 * back, and Compare shows the look from before the studio opened.
 */
async function openDashboard(page, { height = 900 } = {}) {
    await page.setViewportSize({ width: 1500, height });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
}

const studio = (page) => page.locator('[data-look-studio]');

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(studio(page)).toBeVisible({ timeout: 15_000 });
}

const stored = (page) => page.evaluate(async () => {
    const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    return (await api('/api/settings')).json();
});

const bodyAttr = (page, name) => page.evaluate((n) => document.body.getAttribute(n), name);

const dirtyTabs = (page) => page.locator('.look-studio-tab.is-dirty').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-studio-tab')));

test.describe('the look studio', () => {
    // Each save writes the whole settings object: these take turns.
    test.describe.configure({ mode: 'serial' });

    test('lies over the dashboard without moving it; ←/→ walk the tabs and the page still scrolls', async ({ page }) => {
        await openDashboard(page, { height: 420 });
        // Where the columns are, as a reader sees them.
        const columns = () => page.locator('.category').evaluateAll(
            (els) => els.slice(0, 6).map((el) => {
                const r = el.getBoundingClientRect();
                return [Math.round(r.left), Math.round(r.width)];
            }));
        const before = await columns();
        expect(before.length, 'no columns to measure').toBeGreaterThan(0);
        await openStudio(page);

        const box = await studio(page).boundingBox();
        expect(box?.x, 'the panel is not on the right').toBeGreaterThan(900);
        expect(await columns(), 'opening the studio moved the columns').toEqual(before);

        const selected = () => page.locator('.look-studio-tab[aria-selected="true"]').getAttribute('data-studio-tab');
        await page.locator('[data-studio-tab="themes"]').focus();
        await page.keyboard.press('ArrowRight');
        expect(await selected()).toBe('backdrop');
        await page.keyboard.press('ArrowRight');
        expect(await selected()).toBe('surface');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        expect(await selected(), 'left from the first tab should wrap to the last').toBe('looks');

        // The page beside it is inert, but the wheel still scrolls it.
        expect(await page.evaluate(() => document.getElementById('dashboard-layout')?.closest('[inert]') !== null)).toBe(true);
        await page.mouse.move(300, 250);
        await page.mouse.wheel(0, 600);
        await expect.poll(() => page.evaluate(() => window.scrollY),
            { message: 'the dashboard did not scroll under the studio' }).toBeGreaterThan(0);

        await page.keyboard.press('Escape');
        await expect(studio(page)).toHaveCount(0);
        expect(await page.evaluate(() => document.querySelector('[inert]'))).toBeNull();
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await columns(), 'closing the studio left the columns moved').toEqual(before);
    });

    test('a change is live and dotted, and Cancel puts it back without storing it', async ({ page }) => {
        await openDashboard(page);
        const before = await stored(page);
        const recipeBefore = await bodyAttr(page, 'data-backdrop-recipe');
        await openStudio(page);

        await page.locator('[data-studio-tab="backdrop"]').click();
        await page.locator('[data-backdrop-mode="pick"]').click();
        await page.locator('[data-backdrop-recipe="waves"]').click();
        await expect.poll(() => bodyAttr(page, 'data-backdrop-recipe')).toBe('waves');
        await expect.poll(() => dirtyTabs(page)).toEqual(['backdrop']);

        // A new roll of the seed asks the stylesheet for it, unsaved.
        const seeded = page.waitForRequest((req) => /\/api\/theme\.css\?.*seed=\d+/.test(req.url()));
        await page.locator('[data-backdrop-roll]').click();
        await seeded;

        const during = await stored(page);
        expect(during.themeBackdrop).toBe(before.themeBackdrop);
        expect(during.themeSurfacePrefs || {}).toEqual(before.themeSurfacePrefs || {});
        expect(during.backdropTuning?.seed || 0).toBe(before.backdropTuning?.seed || 0);

        await page.locator('[data-studio-cancel]').click();
        await expect(studio(page)).toHaveCount(0);
        await expect.poll(() => bodyAttr(page, 'data-backdrop-recipe')).toBe(recipeBefore);
        const after = await stored(page);
        expect(after.themeSurfacePrefs || {}).toEqual(before.themeSurfacePrefs || {});
        expect(after.backdropTuning?.seed || 0).toBe(before.backdropTuning?.seed || 0);
    });

    test('a setting outside the look still saves while the studio is open, and Cancel leaves it', async ({ page }) => {
        await openDashboard(page);
        await openStudio(page);
        const star = page.locator('[data-theme-favorite]').first();
        const id = await star.getAttribute('data-theme-favorite');
        const wasOn = (await star.getAttribute('aria-pressed')) === 'true';
        await star.click();
        await expect.poll(async () => ((await stored(page)).favoriteThemes || []).includes(id)).toBe(!wasOn);

        await page.keyboard.press('Escape');
        await expect(studio(page)).toHaveCount(0);
        expect(((await stored(page)).favoriteThemes || []).includes(id)).toBe(!wasOn);
    });

    test('pointing at a theme shows it, and leaving the grid shows the chosen one again', async ({ page }) => {
        await openDashboard(page);
        await openStudio(page);
        const chosen = await page.evaluate(() => window.dashboardInstance.settings.theme);
        const shown = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

        const card = page.locator('[data-theme-card]:not(.is-current)').first();
        const id = await card.getAttribute('data-theme-id');
        await card.hover();
        await expect.poll(shown).toBe(id);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme), 'hovering chose the theme').toBe(chosen);
        await expect.poll(() => dirtyTabs(page)).toEqual([]);

        // Out of the grid, onto the footer.
        await page.locator('[data-studio-compare]').hover();
        await expect.poll(shown).toBe(chosen);

        await page.keyboard.press('Escape');
    });

    test('Enter on a theme card shows that theme and keeps the studio open', async ({ page }) => {
        await openDashboard(page);
        const before = (await stored(page)).theme;
        await openStudio(page);

        const card = page.locator('[data-theme-card]:not(.is-current)').first();
        const id = await card.getAttribute('data-theme-id');
        await card.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(id);
        await expect(studio(page)).toBeVisible();
        await expect.poll(() => dirtyTabs(page)).toContain('themes');
        expect((await stored(page)).theme).toBe(before);

        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(before);
    });

    test('Compare, held with \\, shows the look from before the studio opened', async ({ page }) => {
        await openDashboard(page);
        const headBefore = await bodyAttr(page, 'data-cat-head');
        await openStudio(page);

        await page.locator('[data-studio-tab="heads"]').click();
        const style = headBefore === 'label' ? 'boxed' : 'label';
        await page.selectOption('[data-behavior-field="categoryHeaderStyle"]', style);
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(style);

        await page.locator('[data-studio-tab="heads"]').focus();
        await page.keyboard.down('\\');
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(headBefore);
        await page.keyboard.up('\\');
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(style);

        // The button is a switch: on until pressed again.
        const compare = page.locator('[data-studio-compare]');
        await compare.click();
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(headBefore);
        await expect(compare).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(300);
        expect(await bodyAttr(page, 'data-cat-head'), 'Compare let go on its own').toBe(headBefore);
        await compare.click();
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(style);

        // Touching anything else first puts the changes back, so nothing is
        // changed on top of the old look.
        await compare.click();
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(headBefore);
        await page.locator('[data-studio-tab="looks"]').click();
        await expect(compare).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(style);

        await page.keyboard.press('Escape');
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe(headBefore);
    });

    test('Apply stores everything in one go and it is still there after a reload', async ({ page }) => {
        await openDashboard(page);
        const before = await stored(page);
        await openStudio(page);

        await page.locator('[data-studio-tab="looks"]').click();
        await page.locator('[data-studio-use-look="homepage-boxed"]').click();
        await expect.poll(() => bodyAttr(page, 'data-cat-head')).toBe('boxed');
        await expect.poll(() => dirtyTabs(page)).toEqual(['backdrop', 'surface', 'heads']);

        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        await expect(studio(page)).toHaveCount(0);
        await expect.poll(async () => (await stored(page)).categoryHeaderStyle).toBe('boxed');

        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        expect(await bodyAttr(page, 'data-cat-head')).toBe('boxed');
        expect(await bodyAttr(page, 'data-backdrop-recipe')).toBe('mountains');
        expect(await bodyAttr(page, 'data-depth')).toBe('glass');

        // Put back what this moved, for the specs after it.
        await page.waitForFunction(() => window.dashboardInstance?.settings, null, { timeout: 20_000 });
        // Absent fields are written as their empty value: a save keeps a field
        // it is not sent, so deleting one would leave this test's look behind.
        await page.evaluate(async (prev) => {
            const d = window.dashboardInstance;
            const empty = { themeSurfacePrefs: {}, cardGlass: {}, themeBackdrop: 'follow', themeDepth: 'follow' };
            ['categoryHeaderStyle', 'showCategoryIcon', 'showCategoryCount', 'themeSurfacePrefs',
                'backdropTuning', 'themeBackdrop', 'cardGlass', 'themeDepth'].forEach((key) => {
                if (prev[key] !== undefined) d.settings[key] = prev[key];
                else if (key in empty) d.settings[key] = empty[key];
                else delete d.settings[key];
            });
            await d.saveSettings();
        }, before);
    });

    test('card glass says why nothing changes, and gives a layout without cards its panes', async ({ page }) => {
        await openDashboard(page);
        const before = await stored(page);
        // A layout that draws no card round a category, on a theme not at
        // Glass, and no card glass of the reader's own. Written as empty
        // values rather than left out: a save keeps a field it is not sent.
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, {
                layoutPreset: 'default', themeDepth: 'flat', themeSurfacesForceAll: false,
                themeSurfacePrefs: {}, cardGlass: {},
            });
            await d.saveSettings();
        });
        await page.reload();
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await waitForConfigReady(page);
        await openStudio(page);
        await page.locator('[data-studio-tab="surface"]').click();

        const panel = page.locator('[data-glass-panel]');
        await expect(panel.locator('[data-glass-depth-hint]')).toBeVisible();
        await expect(panel.locator('[data-glass-layout-hint]')).toBeVisible();

        await panel.locator('[data-glass-action="depth"]').click();
        await expect.poll(() => bodyAttr(page, 'data-depth')).toBe('glass');
        await expect(page.locator('[data-glass-panel] [data-glass-depth-hint]')).toHaveCount(0);

        const categoryAlpha = () => page.locator('.dashboard-grid .category').first().evaluate(
            (el) => getComputedStyle(el).backgroundColor);
        expect(await categoryAlpha(), 'a default-layout category had a pane before Own').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

        await page.locator('[data-glass-panel] [data-glass-mode="own"]').click();
        await expect(page.locator('[data-glass-panel] [data-glass-layout-hint]')).toHaveCount(0);
        await expect.poll(categoryAlpha, { message: 'Own gave the category no pane' }).not.toMatch(/rgba\(0, 0, 0, 0\)/);
        const first = await categoryAlpha();
        await page.locator('[data-glass-range="alpha"]').fill('0.3');
        await expect.poll(categoryAlpha, { message: 'the opacity slider did not reach the pane' }).not.toBe(first);

        await page.keyboard.press('Escape');
        await expect(studio(page)).toHaveCount(0);

        // The layout dropdown redraws the grid at once. A layout is not part of
        // the look, so it saves.
        await openStudio(page);
        await page.locator('[data-studio-tab="surface"]').click();
        await page.selectOption('[data-glass-panel] [data-glass-layout]', 'cards');
        await expect.poll(() => page.locator('.dashboard-grid').getAttribute('class')).toContain('layout-cards');
        await expect(page.locator('[data-glass-panel] [data-glass-layout-hint]')).toHaveCount(0);
        await expect.poll(async () => (await stored(page)).layoutPreset).toBe('cards');
        await page.keyboard.press('Escape');

        await page.evaluate(async (prev) => {
            const d = window.dashboardInstance;
            ['layoutPreset', 'themeDepth'].forEach((key) => {
                if (prev[key] === undefined) delete d.settings[key]; else d.settings[key] = prev[key];
            });
            await d.saveSettings();
        }, before);
    });

    test('opened from Appearance, it hands the page back to Appearance on close', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.locator('[data-appearance-action="browse-themes"]').first().click();
        await expect(studio(page)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('config');

        await page.locator('[data-studio-cancel]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });
});
