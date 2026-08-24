// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Behavior: every control has to do what it appears to do.
 *
 * Two did not. One wrote a setting the server has never had, so it flipped,
 * saved, and came back false on the next load. The other was rendered twice —
 * once here through the generic schema, which cannot reach the browser storage
 * it actually lives in, and once on Data & backups, which could. And ten ℹ
 * buttons opened a dialog with an empty title and an empty body, because the
 * button is drawn from the presence of a reference rather than of text.
 */

async function openBehavior(page, tab = 'general') {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((t) => {
        const c = window.dashboardInstance.config;
        c.openConfigView('behavior');
        c.behaviorTab = t;
        c.render();
    }, tab);
    await page.waitForTimeout(600);
}

test.describe('a control writes something that survives', () => {
    test('the device toggle reaches the storage it lives in', async ({ page }) => {
        await openBehavior(page);
        await page.evaluate(() => localStorage.removeItem('deviceSpecificSettings'));

        const box = page.locator('[data-behavior-field="deviceSpecificSettings"]');
        await expect(box).toHaveCount(1);
        await box.first().click();

        // Rendered by the same schema as its neighbours, it used to fall through
        // to the ordinary save — which writes a key the server drops.
        await expect.poll(() => page.evaluate(() => localStorage.getItem('deviceSpecificSettings')),
            { timeout: 5_000 }).toBe('true');

        // And it draws its state from there, not from the settings object.
        await page.evaluate(() => window.dashboardInstance.config.render());
        await page.waitForTimeout(400);
        expect(await page.locator('[data-behavior-field="deviceSpecificSettings"]').first().isChecked()).toBe(true);
    });

    test('it is offered in one place, not two', async ({ page }) => {
        await openBehavior(page);
        await expect(page.locator('[data-behavior-field="deviceSpecificSettings"]')).toHaveCount(1);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.waitForTimeout(800);
        await expect(page.locator('[data-backup-toggle="deviceSpecificSettings"]')).toHaveCount(0);
    });
});

test.describe('the affordances beside a setting', () => {
    test('no info button without something to say', async ({ page }) => {
        await openBehavior(page, 'privacy');

        const empty = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return [...document.querySelectorAll('[data-info-field]')]
                .map((btn) => btn.getAttribute('data-info-field'))
                .filter((field) => !c.hasInfoText(c.fieldMeta(field)?.info));
        });
        expect(empty).toEqual([]);
    });

    test('the analytics info opens real text', async ({ page }) => {
        await openBehavior(page, 'privacy');
        await page.locator('[data-info-field="analyticsOptIn"]').first().click();
        const modal = page.locator('#app-modal.show .modal');
        await expect(modal).toBeVisible({ timeout: 10_000 });
        // It used to open a dialog with an empty title, an empty body, and a
        // Got it button.
        await expect(modal).toContainText(/analytics/i);
        expect((await modal.innerText()).trim().length).toBeGreaterThan(60);
    });

    test('a reset button that would do nothing is out of the way', async ({ page }) => {
        await openBehavior(page, 'general');
        const state = await page.evaluate(() => {
            const all = [...document.querySelectorAll('[data-reset-field]')];
            return all.map((b) => ({
                visible: b.classList.contains('is-visible'),
                hidden: b.getAttribute('aria-hidden') === 'true',
                tabindex: b.getAttribute('tabindex'),
            }));
        });
        expect(state.length).toBeGreaterThan(0);
        for (const btn of state) {
            // Shown means reachable; not shown means neither tabbable nor read
            // out, rather than a Reset on every setting already at its default.
            expect(btn.hidden).toBe(!btn.visible);
            expect(btn.tabindex === '-1').toBe(!btn.visible);
        }
    });
});

test.describe('finding a setting on a crowded tab', () => {
    test('the filter narrows the controls, and says when nothing matches', async ({ page }) => {
        await openBehavior(page, 'general');
        const field = page.locator('[data-settings-filter]');
        await expect(field).toBeVisible();

        const before = await page.locator('#config-behavior-body [data-behavior-field]').count();
        expect(before).toBeGreaterThan(2);

        await field.fill('language');
        await expect.poll(() => page.locator('#config-behavior-body [data-behavior-field]').count(),
            { timeout: 5_000 }).toBeLessThan(before);

        await field.fill('zzzznothingatall');
        await expect(page.locator('#config-behavior-body .config-panel-empty'))
            .toContainText(/matches/i, { timeout: 5_000 });

        // Escape clears it rather than closing config.
        await field.press('Escape');
        await expect.poll(() => page.locator('#config-behavior-body [data-behavior-field]').count(),
            { timeout: 5_000 }).toBe(before);
    });

    test('it matches what the reader can see, not the field name alone', async ({ page }) => {
        await openBehavior(page, 'general');
        const matched = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.settingsFilter = 'language';
            const panels = c.panelsFor('behavior', 'general');
            const hits = panels.flatMap((p) => (p.controls || []).filter((x) => c.controlMatchesFilter(x)));
            c.settingsFilter = '';
            return hits.map((h) => h.label);
        });
        expect(matched.length).toBeGreaterThan(0);
        expect(matched.join(' ').toLowerCase()).toContain('language');
    });
});
