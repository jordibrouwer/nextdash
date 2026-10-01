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
        await page.evaluate(async (prev) => {
            const d = window.dashboardInstance;
            ['categoryHeaderStyle', 'showCategoryIcon', 'showCategoryCount', 'themeSurfacePrefs',
                'backdropTuning', 'themeBackdrop', 'cardGlass', 'themeDepth'].forEach((key) => {
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
