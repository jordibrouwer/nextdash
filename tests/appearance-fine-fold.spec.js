// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady, openConfigPanel } = require('./e2e-helpers');

/**
 * Fine-tune folds on Appearance → Background and Surface.
 *
 * The slider detail (backdrop intensity to tint, card glass opacity and blur)
 * sits under a header that starts folded and says how many of its settings
 * differ from the default. A filter hit, Only changed and a jump into it open
 * it; the reader's own choice is remembered and survives a repaint.
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
    // The folds live inside panels that fold themselves; open the one that
    // holds the fold, through its header.
    const holder = { background: 'Backdrop', surface: 'Card glass' }[tab];
    if (holder) await openConfigPanel(page, holder);
}

const head = (id) => `[data-fine="${id}"] [data-fine-toggle]`;

/** Put the backdrop sliders back to their defaults, through the settings API. */
async function resetTuning(page) {
    await page.evaluate(async () => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await send('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                backdropTuning: { strength: 1, scale: 1, seed: 0, blur: 0, brightness: 1, saturate: 1, tint: 0 },
                backgroundOpacity: 1,
            }),
        });
    });
}

test.describe('Fine-tune folds', () => {
    test.afterEach(async ({ page }) => {
        if (page.url().startsWith('http')) await resetTuning(page);
    });

    test('folded by default, says what differs, opens on a click', async ({ page }) => {
        await openTab(page, 'background');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator(head('backdrop'))).toContainText('At defaults');
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeHidden();

        await page.locator(head('backdrop')).click();
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeVisible();

        // The summary follows the sliders as they move.
        await page.locator('[data-backdrop-tuning="strength"]').fill('0.5');
        await page.locator('[data-backdrop-tuning="blur"]').fill('10');
        await expect(page.locator(head('backdrop'))).toContainText('2 changed');
        await page.locator('[data-backdrop-tuning="blur"]').fill('0');
        await expect(page.locator(head('backdrop'))).toContainText('1 changed');
    });

    test('the choice is remembered, and a repaint of the body keeps it', async ({ page }) => {
        await openTab(page, 'background');
        await page.locator(head('backdrop')).click();
        await page.locator('[data-backdrop-tuning="strength"]').fill('0.5');

        // "Back to the defaults" draws the body again.
        await page.locator('[data-backdrop-reset]').click();
        await expect(page.locator(head('backdrop'))).toContainText('At defaults');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeVisible();

        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await waitForConfigReady(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
        await page.click('[data-appearance-tab="background"]');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'true');

        await page.locator(head('backdrop')).click();
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeHidden();
    });

    test('a filter hit inside opens it, and clearing the filter folds it again', async ({ page }) => {
        await openTab(page, 'background');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'false');

        await page.locator('[data-settings-filter]').fill('saturation');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-backdrop-tuning="saturate"]')).toBeVisible();
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeHidden();

        await page.locator('[data-settings-filter]').fill('');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-backdrop-tuning="saturate"]')).toBeHidden();
    });

    test('a filter with no hit inside leaves the fold out', async ({ page }) => {
        await openTab(page, 'background');
        await page.locator('[data-settings-filter]').fill('pattern');
        await expect(page.locator('[data-fine="backdrop"]')).toBeHidden();
    });

    test('Only changed opens it when something inside differs', async ({ page }) => {
        await openTab(page, 'background');
        await page.locator(head('backdrop')).click();
        await page.locator('[data-backdrop-tuning="tint"]').fill('0.5');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.dash.settings.backdropTuning?.tint)).toBe(0.5);
        await page.locator(head('backdrop')).click();
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'false');

        // The toggle needs a setting with a default that differs; opacity is
        // one, and the tab reads it when it is drawn.
        await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backgroundOpacity: 0.8 }),
            });
        });
        await openTab(page, 'background');
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'false');
        await page.locator('.config-view-head [data-config-action="toggle-changed"]').click();
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'true');
        // Only the slider that differs is left.
        await expect(page.locator('[data-backdrop-tuning="tint"]')).toBeVisible();
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeHidden();
    });

    test('a jump from Find settings into it opens it', async ({ page }) => {
        await openTab(page, 'general');
        await expect(page.locator('[data-fine]')).toHaveCount(0);
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('Backdrop settings');
        const hit = page.locator('.config-settings-jump-result', { hasText: 'Backdrop settings' }).first();
        await hit.click();
        await expect(page.locator(head('backdrop'))).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-backdrop-tuning="strength"]')).toBeVisible();
    });

    test('card glass: folded, and the sliders work through it', async ({ page }) => {
        await openTab(page, 'surface');
        await expect(page.locator(head('glass'))).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-glass-range="alpha"]')).toBeHidden();
        await page.locator(head('glass')).click();
        await expect(page.locator('[data-glass-range="alpha"]')).toBeVisible();
        await expect(page.locator('[data-glass-range="blur"]')).toBeVisible();
        // Mode, edge and contrast stay outside the fold.
        await expect(page.locator('[data-glass-mode="own"]')).toBeVisible();
        await expect(page.locator('[data-glass-border]')).toBeVisible();
    });

    test('a schema panel can use the same control', async ({ page }) => {
        await openTab(page, 'general');
        const result = await page.evaluate(() => {
            const config = window.dashboardInstance.config;
            const panel = {
                title: 'Probe',
                controls: [
                    { type: 'checkbox', field: 'showIcons', label: 'Icons' },
                    { type: 'fine', id: 'probe', controls: [
                        { type: 'checkbox', field: 'showCategoryCount', label: 'Counts' },
                    ] },
                ],
            };
            const host = document.createElement('div');
            host.innerHTML = config.renderControlPanels([panel], 'behavior');
            return {
                folded: host.querySelector('[data-fine="probe"] [data-fine-toggle]')?.getAttribute('aria-expanded'),
                inside: Boolean(host.querySelector('[data-fine="probe"] [data-behavior-field="showCategoryCount"]')),
                outside: Boolean(host.querySelector('.config-panel > .config-field-row [data-behavior-field="showIcons"]')),
                changed: config.panelChangedFields(panel),
            };
        });
        expect(result.folded).toBe('false');
        expect(result.inside).toBe(true);
        expect(result.outside).toBe(true);
        expect(Array.isArray(result.changed)).toBe(true);
    });
});
