const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

async function openBehavior(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#config');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.waitForSelector('.config-field', { timeout: 15_000 });
}

test.describe('settings controls can be identified by a screen reader', () => {
    // The schema renders labels as spans, so selects and number inputs had no
    // accessible name at all — "combo box, 30" with nothing saying which setting.
    test('every schema control carries an accessible name', async ({ page }) => {
        await openBehavior(page);
        const unnamed = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('.config-field').forEach((field) => {
                const label = field.querySelector('.config-field-label')?.textContent?.trim();
                if (!label) return;
                field.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((c) => {
                    const named = c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')
                        || (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`));
                    if (!named) out.push(`${label}: <${c.tagName.toLowerCase()}>`);
                });
            });
            return out;
        });
        expect(unnamed).toEqual([]);
    });

    // Controls bind on `change`, which fires while the control still has focus,
    // and the save replaces the whole body — so Tab restarted from the top.
    test('focus survives the repaint a save triggers', async ({ page }) => {
        await openBehavior(page);

        const field = await page.evaluate(() => {
            const el = document.querySelector('[data-behavior-field]');
            if (!el) return null;
            el.focus();
            return el.getAttribute('data-behavior-field');
        });
        test.skip(!field, 'needs a behavior control');

        await page.evaluate(() => window.dashboardInstance.config.repaintActiveControlPanels());
        const after = await page.evaluate(() =>
            document.activeElement?.getAttribute?.('data-behavior-field') || document.activeElement?.tagName);
        expect(after).toBe(field);
    });
});

test('the confirm dialog keeps Tab inside itself', async ({ page }) => {
    await openBehavior(page);

    await page.evaluate(() => {
        window.__confirm = window.dashboardInstance.config.confirmAction('Really?');
    });
    await page.waitForSelector('#config-confirm-modal', { timeout: 10_000 });

    // Tab past the last control; focus must come back to the dialog, not the page.
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() =>
        !!document.getElementById('config-confirm-modal')?.contains(document.activeElement));
    expect(inside).toBe(true);

    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__confirm);
});
