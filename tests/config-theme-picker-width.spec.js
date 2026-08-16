// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The closed theme field has to hold a theme name on one line.
 *
 * There are 150 of them and the longest run to 25 characters
 * ("Chartreuse Static [light]"), against a button that was 12rem wide — so most
 * names wrapped and the field stood two lines tall, taller than every control
 * beside it.
 *
 * Underneath that sat a class collision: the colour input in the theme editor
 * answered to .config-theme-picker as well, and being the later rule it sized
 * the listbox's wrapper to 34px. Nothing looked wrong while the button carried
 * its own fixed width, and everything did the moment the button sized itself
 * against its container. Both halves are checked here, because fixing the width
 * without the collision only moves the problem.
 */

async function openTheme(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('[data-theme-picker-button]', { timeout: 15_000 });
}

test.describe('the theme field', () => {
    test('every theme name fits on one line', async ({ page }) => {
        await openTheme(page);

        const measured = await page.evaluate(() => {
            const btn = document.querySelector('[data-theme-picker-button]');
            const label = btn.querySelector('[data-theme-picker-label]');
            const names = [...document.querySelectorAll('.config-theme-picker-option')]
                .map((o) => o.textContent.trim());
            const original = label.textContent;

            // One line, measured rather than assumed: the row height depends on
            // the configured text size.
            label.textContent = 'X';
            const oneLine = Math.round(btn.getBoundingClientRect().height);

            let tallest = oneLine;
            let tallestName = '';
            const clipped = [];
            for (const name of names) {
                label.textContent = name;
                const h = Math.round(btn.getBoundingClientRect().height);
                if (h > tallest) { tallest = h; tallestName = name; }
                // Ellipsised is not wrapped, but it is still a name you cannot
                // read, so the built-ins must fit outright.
                if (label.scrollWidth > Math.ceil(label.getBoundingClientRect().width) + 1) clipped.push(name);
            }
            label.textContent = original;
            return { count: names.length, oneLine, tallest, tallestName, clipped };
        });

        expect(measured.count).toBeGreaterThan(20);
        expect(measured.tallest).toBe(measured.oneLine);
        expect(measured.clipped).toEqual([]);
    });

    test('the field is wider than the widest name it has to show', async ({ page }) => {
        await openTheme(page);

        const fits = await page.evaluate(() => {
            const btn = document.querySelector('[data-theme-picker-button]');
            const wrapper = btn.closest('.config-theme-picker');
            const label = btn.querySelector('[data-theme-picker-label]');
            const original = label.textContent;
            label.textContent = 'Chartreuse Static [light]';
            const out = {
                wrapper: Math.round(wrapper.getBoundingClientRect().width),
                button: Math.round(btn.getBoundingClientRect().width),
                label: label.scrollWidth,
            };
            label.textContent = original;
            return out;
        });

        // The wrapper used to be 34px — the colour input's size, applied to the
        // listbox by a shared class name.
        expect(fits.wrapper).toBeGreaterThan(150);
        expect(fits.button).toBeGreaterThanOrEqual(fits.label);
    });

    test('the colour input keeps its own size, under its own name', async ({ page }) => {
        await openTheme(page);

        const swatch = await page.evaluate(() => {
            const host = document.querySelector('#dashboard-layout .config-panel');
            const probe = document.createElement('input');
            probe.type = 'color';
            probe.className = 'config-theme-color-input';
            host.appendChild(probe);
            const rect = probe.getBoundingClientRect();
            const out = { w: Math.round(rect.width), h: Math.round(rect.height) };
            probe.remove();
            return out;
        });
        // Renaming it must not leave it unstyled — it is a native colour input
        // whose chrome is stripped entirely by this rule.
        expect(swatch).toEqual({ w: 34, h: 28 });
    });

    test('the two controls no longer share a class', async ({ page }) => {
        await openTheme(page);
        const markup = await page.evaluate(async () => {
            const res = await fetch('/static/css/config-view.css');
            return res.text();
        });
        // The listbox wrapper keeps the name its script hooks use; the colour
        // input has one of its own, and it is not the 16px dot's either.
        expect(markup).toContain('.config-theme-color-input {');
        expect(markup).not.toMatch(/\.config-theme-picker\s*\{[^}]*inline-size:\s*34px/);
    });
});
