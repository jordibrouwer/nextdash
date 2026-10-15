// @ts-check
const { test, expect } = require('./fixtures');
const {
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    waitForConfigReady,
    markConfigSettingPromosSeen,
    openConfigPanel,
} = require('./e2e-helpers');

/**
 * Config → Appearance folds its panels.
 *
 * The first panel of a tab is open and the rest show one line of what they
 * are set to; a panel opened by its header stays open across a reload; the
 * filter, "Only changed" and a jump from Find settings open the panel that
 * holds what they found. Everything here goes through the header, the filter
 * field or the jump -- the remembered open state is never written by hand.
 */

async function saveSetting(page, field, value) {
    const status = await page.evaluate(async ([f, v]) => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await send('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [f]: v }),
        });
        return res.status;
    }, [field, value]);
    expect(status).toBeLessThan(400);
}

async function openAppearanceTab(page, tab) {
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.appearanceTab = c.appearanceTab || 'general';
        return c.openConfigView('appearance');
    });
    await page.locator(`[data-appearance-tab="${tab}"]`).click();
    await expect(page.locator(`[data-appearance-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
}

/** The panel with this title on the tab on screen. */
function panelOf(page, title) {
    return page.locator('#config-appearance-body .config-panel--fold')
        .filter({ has: page.locator('.config-panel-title', { hasText: new RegExp(`^\\s*${title}\\s*$`, 'i') }) });
}

/** Its fold button. */
function foldOf(page, title) {
    return panelOf(page, title).locator(':scope > .config-panel-head .config-panel-fold');
}

test.describe('Appearance folding panels', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        // Saved once the page has settled, so its own start-up save cannot
        // write the old unit back over it.
        await waitForConfigReady(page);
        await saveSetting(page, 'weatherUnit', 'fahrenheit');
        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.settings?.weatherUnit))
            .toBe('fahrenheit');
        await markConfigSettingPromosSeen(page);
    });

    test.afterEach(async ({ page }) => {
        await saveSetting(page, 'weatherUnit', 'celsius');
        await saveSetting(page, 'timeFormat', '24h');
    });

    test('the first panel is open and a folded one names its values', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await expect(foldOf(page, 'Clock & weather')).toHaveAttribute('aria-expanded', 'true');
        const weather = foldOf(page, 'Weather');
        await expect(weather).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-behavior-field="weatherUnit"]')).toBeHidden();
        const summary = panelOf(page, 'Weather').locator('.config-panel-summary');
        await expect(summary).toBeVisible();
        await expect(summary).toContainText('°F');
    });

    test('a changed setting leads the summary, however far down its panel it is', async ({ page }) => {
        await saveSetting(page, 'alwaysCollapseCategories', true);
        try {
            await page.reload();
            await openAppearanceTab(page, 'layout');
            const layout = panelOf(page, 'Bookmarks layout');
            await foldOf(page, 'Bookmarks layout').click();
            await expect(foldOf(page, 'Bookmarks layout')).toHaveAttribute('aria-expanded', 'false');
            const summary = layout.locator('.config-panel-summary');
            await expect(summary).toHaveText(/^Start with categories collapsed/);
        } finally {
            await saveSetting(page, 'alwaysCollapseCategories', false);
        }
    });

    test('a panel opened by its header stays open after a reload', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await foldOf(page, 'Weather').click();
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-behavior-field="weatherUnit"]')).toBeVisible();
        // Folding the first one is remembered too.
        await foldOf(page, 'Clock & weather').click();
        await expect(foldOf(page, 'Clock & weather')).toHaveAttribute('aria-expanded', 'false');

        await page.reload();
        await openAppearanceTab(page, 'datetime');
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'true');
        await expect(foldOf(page, 'Clock & weather')).toHaveAttribute('aria-expanded', 'false');
        await expect(foldOf(page, 'Calendar')).toHaveAttribute('aria-expanded', 'false');
    });

    test('a changed setting re-renders the tab without folding the panel it is in', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await openConfigPanel(page, 'Weather');
        await page.locator('[data-behavior-field="weatherUnit"]').selectOption('celsius');
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-behavior-field="weatherUnit"]')).toHaveValue('celsius');
    });

    test('Reset panel in a folded header does not open it', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await panelOf(page, 'Weather').locator('.config-panel-reset').click();
        await expect(page.locator('#app-modal.show')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'false');
    });

    test('the filter opens the panel it finds a setting in', async ({ page }) => {
        await openAppearanceTab(page, 'background');
        const tuning = foldOf(page, 'Backdrop');
        await expect(tuning).toHaveAttribute('aria-expanded', 'false');
        await page.locator('[data-settings-filter]').fill('blur');
        await expect(tuning).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-backdrop-tuning="blur"]')).toBeVisible();
        // Cleared, the tab goes back to how it was left.
        await page.locator('[data-settings-filter]').fill('');
        await expect(tuning).toHaveAttribute('aria-expanded', 'false');
    });

    test('Only changed opens the panel holding the change', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        // A change in Date & time too, so it comes before Weather under the
        // filter and Weather is opened by the filter rather than by being first.
        await openConfigPanel(page, 'Date & time');
        await page.locator('[data-behavior-field="timeFormat"]').selectOption('12h');
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'false');
        await page.locator('[data-config-action="toggle-changed"]').first().click();
        await expect(foldOf(page, 'Date & time')).toHaveAttribute('aria-expanded', 'true');
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-behavior-field="weatherUnit"]')).toBeVisible();
    });

    test('a link to a panel opens it', async ({ page }) => {
        await page.goto('/#config/appearance/datetime/weather');
        await page.waitForSelector('#config-appearance-body', { timeout: 15_000 });
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-behavior-field="weatherUnit"]')).toBeVisible();
    });

    test('Find settings lands on a control inside a folded panel', async ({ page }) => {
        await openAppearanceTab(page, 'datetime');
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'false');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('Temperature unit');
        await page.locator('.config-settings-jump-result', { hasText: 'Temperature unit' }).first().click();
        const unit = page.locator('[data-behavior-field="weatherUnit"]');
        await expect(unit).toBeVisible();
        await expect(unit).toBeInViewport();
        await expect(foldOf(page, 'Weather')).toHaveAttribute('aria-expanded', 'true');
    });
});
