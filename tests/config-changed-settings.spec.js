// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * isFieldDefault() already decided whether each ↺ shows, but nothing added it
 * up — so "why does my dashboard behave differently from the documentation"
 * meant opening every tab and looking for a reset arrow.
 *
 * Three surfaces on one calculation: a count on the Overview, an "Only changed"
 * filter per settings tab, and a per-panel reset beside the per-field one.
 */

async function openConfig(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => { const c = window.dashboardInstance.config; if (s === 'appearance' || s === 'behavior') c[`${s}Tab`] = c[`${s}Tab`] || 'general'; return c.openConfigView(s); }, section);
    await page.waitForSelector('.config-view', { timeout: 15_000 });
}

/**
 * Open a settings group.
 *
 * Appearance and Behavior land on a hub of tiles, and a hub carries no fields —
 * so the "Only changed" filter has nothing to act on until a group is open. The
 * tests below drove the filter straight from the section and saw it refuse,
 * which read as the filter being broken rather than as nothing being there yet.
 */
async function openFirstGroup(page) {
    const tile = page.locator('#config-view-body .hub-tile .hub-tile-main').first();
    if (await tile.count()) {
        await tile.click();
        await page.waitForSelector('#config-view-body [data-behavior-field], #config-view-body .config-field',
            { timeout: 10_000 });
    }
}

/** Drive real setting changes through the same path the controls use. */
async function change(page, pairs) {
    await page.evaluate(async (list) => {
        const c = window.dashboardInstance.config;
        for (const [field, value] of list) await c.setBehavior(field, value, '');
    }, pairs);
    await page.waitForTimeout(500);
}

/** Put everything back, so a later spec does not inherit the changes. */
async function restore(page, fields) {
    await page.evaluate(async (list) => {
        const c = window.dashboardInstance.config;
        for (const f of list) {
            const def = c.fieldMeta(f)?.def;
            if (def !== undefined) await c.setBehavior(f, def, '');
        }
    }, fields);
    await page.waitForTimeout(500);
}

/*
 * The count that used to sit on the Overview is gone: the overview was rebuilt
 * around the collection and no longer reports on settings. What the calculation
 * still feeds is the "Only changed" filter and the per-panel reset, which is
 * what the tests below cover. The reading itself — changedSettings() — is still
 * the one thing all of it rests on.
 */
test.describe('what counts as a changed setting', () => {
    /**
     * With every setting at its default the count is zero and the line is not
     * rendered at all.
     *
     * Everything is reset first rather than assuming the install is untouched:
     * settings persist server-side between specs, and config-auto-dark leaves
     * the theme and autoDarkMode changed on purpose. That the defaults really
     * do add up to zero on a fresh install is pinned in
     * config-field-defaults.spec.js, which runs before anything can dirty it.
     */
    test('with everything at its default there is no count and no line', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            for (const e of c.changedSettings()) {
                const def = c.fieldMeta(e.field)?.def;
                if (def !== undefined) await c.setBehavior(e.field, def, '');
            }
            c.repaintOverview();
        });

        const changed = await page.evaluate(() =>
            window.dashboardInstance.config.changedSettings().map((e) => e.field));
        expect(changed, `these still differ after a reset:\n${changed.join('\n')}`).toEqual([]);
    });

    /** The count is over the declared index, not the rendered DOM. */
    test('the count sees tabs that were never opened', async ({ page }) => {
        await openConfig(page, 'overview');
        // Lives on Behavior › Status, which the Overview never renders.
        await change(page, [['statusOfflineRetries', 7]]);

        const changed = await page.evaluate(() =>
            window.dashboardInstance.config.changedSettings().map((e) => e.field));
        expect(changed).toContain('statusOfflineRetries');

        await restore(page, ['statusOfflineRetries']);
    });

});

test.describe('the "Only changed" filter', () => {
    test('it hides the settings that are still at their default', async ({ page }) => {
        await openConfig(page, 'behavior');
        await openFirstGroup(page);
        await change(page, [['openInNewTab', false]]);

        const all = await page.locator('[data-behavior-field]').count();
        await page.locator('[data-config-action="toggle-changed"]').click();
        await expect(page.locator('[data-config-action="toggle-changed"]')).toHaveAttribute('aria-pressed', 'true');

        const shown = await page.locator('[data-behavior-field]').count();
        expect(shown).toBe(1);
        expect(shown).toBeLessThan(all);
        await expect(page.locator('[data-behavior-field="openInNewTab"]')).toBeVisible();

        await restore(page, ['openInNewTab']);
    });

    test('the bar counts what differs on this tab', async ({ page }) => {
        await openConfig(page, 'behavior');
        await change(page, [['openInNewTab', false], ['globalShortcuts', false]]);

        await expect(page.locator('.config-changed-count')).toHaveText(/\b2\b/);
        await restore(page, ['openInNewTab', 'globalShortcuts']);
    });

    test('with nothing changed the toggle is offered but disabled', async ({ page }) => {
        await openConfig(page, 'behavior');
        const toggle = page.locator('[data-config-action="toggle-changed"]');
        await expect(toggle).toBeVisible();
        await expect(toggle).toBeDisabled();
    });

    test('turning it off brings the rest back', async ({ page }) => {
        await openConfig(page, 'behavior');
        await change(page, [['openInNewTab', false]]);
        const all = await page.locator('[data-behavior-field]').count();

        await page.locator('[data-config-action="toggle-changed"]').click();
        await expect(page.locator('[data-behavior-field]')).toHaveCount(1);
        await page.locator('[data-config-action="toggle-changed"]').click();
        await expect(page.locator('[data-behavior-field]')).toHaveCount(all);

        await restore(page, ['openInNewTab']);
    });

    /**
     * A view of the page for a minute, not a preference: coming back to a
     * half-empty tab you did not ask for reads as settings having gone missing.
     */
    test('the filter does not survive leaving config', async ({ page }) => {
        await openConfig(page, 'behavior');
        await change(page, [['openInNewTab', false]]);
        await page.locator('[data-config-action="toggle-changed"]').click();
        await expect(page.locator('[data-config-action="toggle-changed"]')).toHaveAttribute('aria-pressed', 'true');

        await openConfig(page, 'behavior');
        await expect(page.locator('[data-config-action="toggle-changed"]')).toHaveAttribute('aria-pressed', 'false');

        await restore(page, ['openInNewTab']);
    });
});

test.describe('reset a whole panel', () => {
    test('the action appears only when something in the panel differs', async ({ page }) => {
        await openConfig(page, 'behavior');
        await expect(page.locator('[data-panel-reset]')).toHaveCount(0);

        await change(page, [['openInNewTab', false]]);
        await expect(page.locator('[data-panel-reset]')).toHaveCount(1);

        await restore(page, ['openInNewTab']);
    });

    test('it restores every changed field in that panel at once', async ({ page }) => {
        await openConfig(page, 'behavior');
        // Two fields from the same panel. They used to be openInNewTab and
        // globalShortcuts, which shared the old catch-all General; the two are
        // under Opening links and Keyboard now, so a reset of one panel is
        // correctly not a reset of the other. Both of these default to on, so
        // a restore is something the test can see.
        await change(page, [['globalShortcuts', false], ['showGridKeyLegend', false]]);

        await page.locator('[data-panel-reset]').click();
        // AppModal is in-page rather than a native dialog; the confirm button
        // is the first .modal-button in the actions row.
        await page.locator('#app-modal .modal-button').first().click();

        await expect.poll(() => page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            return [s.globalShortcuts, s.showGridKeyLegend];
        }), { timeout: 10_000 }).toEqual([true, true]);
    });

    /** One write for the panel, not one per field. */
    test('resetting a panel saves once', async ({ page }) => {
        await openConfig(page, 'behavior');
        await change(page, [['globalShortcuts', false], ['showGridKeyLegend', false]]);

        let saves = 0;
        await page.route('**/api/settings', (route) => {
            if (route.request().method() !== 'GET') saves += 1;
            return route.continue();
        });

        await page.locator('[data-panel-reset]').click();
        await page.locator('#app-modal .modal-button').first().click();

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.settings.globalShortcuts), { timeout: 10_000 }).toBe(true);
        await page.waitForTimeout(500);

        expect(saves, `two fields must not mean two writes (saw ${saves})`).toBe(1);
    });
});
