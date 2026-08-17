// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Config has two row shapes and they are not interchangeable:
 *
 *   .config-field      — a labelled control. The label sits in the grid's first
 *                        column, beside a select or a text input.
 *   .config-field-row  — a checkbox. The label belongs inside the <label>, so
 *                        the words are part of the click target.
 *
 * "Follow system dark mode" used the first for a checkbox, which detached the
 * two: the text rendered in the label column while the <label> wrapped only the
 * box. It looked like a different kind of row than the checkboxes around it,
 * and clicking the words did nothing at all.
 */

async function openAppearance(page, tab) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 15_000 });
    if (tab) {
        await page.locator(`[data-appearance-tab="${tab}"]`).click();
        await expect(page.locator(`[data-appearance-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
    }
}

test.describe('checkboxes use one row shape', () => {
    /**
     * The whole point of the split, asserted where it is cheapest to check: no
     * checkbox anywhere in the view sits in a `.config-field`.
     */
    test('no checkbox is rendered in a labelled-control row', async ({ page }) => {
        await openAppearance(page);

        // Walk every Appearance tab plus the Behavior tabs, since both draw
        // checkboxes and only one of them goes through the schema.
        const offenders = [];
        for (const [section, tabs, attr] of [
            ['appearance', ['general', 'layout', 'display', 'toolbar'], 'data-appearance-tab'],
            ['behavior', ['general', 'datetime', 'search', 'inbox', 'status', 'privacy'], 'data-behavior-tab'],
        ]) {
            await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
            for (const tab of tabs) {
                await page.locator(`[${attr}="${tab}"]`).click();
                await page.waitForTimeout(200);
                const found = await page.evaluate(({ s, t }) => {
                    const out = [];
                    document.querySelectorAll('#config-section-panel .config-field').forEach((row) => {
                        const box = row.querySelector('input[type="checkbox"]');
                        if (!box) return;
                        const name = box.getAttribute('data-appearance-toggle')
                            || box.getAttribute('data-behavior-field')
                            || box.getAttribute('data-backup-toggle') || '?';
                        out.push(`${s}/${t}: ${name}`);
                    });
                    return out;
                }, { s: section, t: tab });
                offenders.push(...found);
            }
        }

        expect(offenders, `checkboxes in a .config-field row:\n${offenders.join('\n')}`).toEqual([]);
    });

    /**
     * The consequence, not just the markup: the label has to toggle the box.
     * This is what was actually broken.
     */
    test('clicking a checkbox label toggles it', async ({ page }) => {
        await openAppearance(page);

        for (const field of ['autoDarkMode', 'showBackgroundDots']) {
            const box = page.locator(`[data-appearance-toggle="${field}"]`);
            const before = await box.isChecked();
            await page.locator('.config-field-row', { has: box }).locator('label span').first().click();
            await expect(box, `clicking the "${field}" label did not toggle it`)
                .toBeChecked({ checked: !before });
            // Put it back, so the run leaves no changed settings behind.
            await page.locator('.config-field-row', { has: box }).locator('label span').first().click();
            await expect(box).toBeChecked({ checked: before });
        }
    });

    test('the label text lives inside the label element', async ({ page }) => {
        await openAppearance(page);

        const detached = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('#config-section-panel input[type="checkbox"]').forEach((box) => {
                const label = box.closest('label.config-toggle');
                // Every checkbox is wrapped, and that wrapper carries the text.
                if (!label || !label.textContent.trim()) {
                    out.push(box.getAttribute('data-appearance-toggle')
                        || box.getAttribute('data-behavior-field') || '?');
                }
            });
            return out;
        });

        expect(detached, `checkboxes with no label text of their own:\n${detached.join('\n')}`).toEqual([]);
    });

    /**
     * Checkboxes in one panel line up with each other. A `.config-field`
     * checkbox is indented into the grid's control column while a
     * `.config-field-row` one starts at the panel's edge, so a panel holding
     * both had two different left edges.
     *
     * Read on Display, whose panels carry three and six boxes: the theme panel
     * has a single checkbox, where a spread is zero however it is rendered.
     */
    test('checkbox rows in one panel share a left edge', async ({ page }) => {
        await openAppearance(page, 'display');

        const panels = await page.evaluate(() =>
            [...document.querySelectorAll('#config-section-panel .config-panel')]
                .map((p) => ({
                    title: p.querySelector('.config-panel-title')?.textContent?.trim() || '?',
                    lefts: [...p.querySelectorAll('input[type="checkbox"]')]
                        .map((b) => Math.round(b.getBoundingClientRect().left)),
                }))
                .filter((p) => p.lefts.length > 1));

        expect(panels.length, 'no panel with several checkboxes was found').toBeGreaterThan(0);
        for (const p of panels) {
            const spread = Math.max(...p.lefts) - Math.min(...p.lefts);
            expect(spread, `"${p.title}" starts its boxes at ${p.lefts.join(', ')}`).toBeLessThanOrEqual(1);
        }
    });

    /** The ℹ/↺ pair still belongs to the row after the change. */
    test('the affordances stay with the setting', async ({ page }) => {
        await openAppearance(page);
        const row = page.locator('.config-field-row', {
            has: page.locator('[data-appearance-toggle="autoDarkMode"]'),
        });
        await expect(row.locator('[data-info-field="autoDarkMode"]')).toHaveCount(1);
    });
});
