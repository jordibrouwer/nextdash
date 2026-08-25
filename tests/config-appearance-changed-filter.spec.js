// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * "Only changed" works on Appearance, not just Behavior.
 *
 * The filter was built for the schema-driven tabs and skipped Appearance
 * entirely, because most of its controls are written out by hand and there was
 * no declaration to filter them from. The count now reads both sources —
 * behaviorSchema() for the panels it owns, MANUAL_JUMP_FIELDS for the rest —
 * and the hand-written rows are hidden through the DOM, keyed by the field name
 * appearanceAff stamps on each row.
 */
/**
 * Reset the fields a test depends on, then open the tab.
 *
 * The reset has to happen after the first navigation — a bare page has no
 * origin, so a relative /api/settings cannot be resolved — but before the
 * render the assertions read, hence the reload in between.
 */
async function openAppearance(page, tab, resets = []) {
    await page.goto('/');
    if (resets.length) {
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        for (const [field, value] of resets) await resetField(page, field, value);
        await page.reload();
    }
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    if (tab) {
        await page.locator(`[data-appearance-tab="${tab}"]`).click();
    }
    await expect(page.locator('#config-appearance-body')).toBeVisible();
}

/** Put one setting back to its default so a tab starts clean. */
async function resetField(page, field, value) {
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

const bar = '#config-appearance-body .config-changed-bar';
const toggle = '#config-appearance-body [data-config-action="toggle-changed"]';

test.describe('appearance only-changed filter', () => {
    // Branding is not a tab: one toggle, a text field and an upload live on
    // Display rather than owning a tab of their own.
    for (const tab of ['general', 'layout', 'buttonbar', 'display', 'toolbar']) {
        test(`the ${tab} tab offers the filter`, async ({ page }) => {
            await openAppearance(page, tab);
            await expect(page.locator(bar)).toBeVisible();
            await expect(page.locator(toggle)).toBeVisible();
        });
    }

    test('the count covers hand-written controls, not just schema panels', async ({ page }) => {
        await openAppearance(page, 'buttonbar', [['buttonBarPosition', 'bottom-right']]);

        const before = await page.locator('.config-changed-count').innerText();

        // Button bar position is hand-written — the half the filter used to be
        // blind to. Changing it has to move the count.
        await page.locator('[data-appearance-barpos="side-left"]').click();
        await expect.poll(async () => page.locator('.config-changed-count').innerText())
            .not.toBe(before);
        await expect(page.locator('.config-changed-count')).toContainText('differ from the default');

        await resetField(page, 'buttonBarPosition', 'bottom-right');
    });

    test('turning it on hides the unchanged hand-written rows', async ({ page }) => {
        await openAppearance(page, 'buttonbar', [
            ['buttonBarPosition', 'bottom-right'],
            ['showSearchButton', true],
        ]);

        // Change exactly one hand-written setting, then filter.
        await page.locator('[data-appearance-barpos="side-left"]').click();
        await expect(page.locator(toggle)).toBeEnabled();
        await page.locator(toggle).click();

        // The one that changed survives; the toggle panels beside it, which
        // are still stock, go.
        await expect(page.locator('[data-appearance-barpos="side-left"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="showSearchButton"]')).toBeHidden();

        // Turning it back off brings everything back.
        await page.locator(toggle).click();
        await expect(page.locator('[data-behavior-field="showSearchButton"]')).toBeVisible();

        await resetField(page, 'buttonBarPosition', 'bottom-right');
    });

    /**
     * A row hidden inside a panel that survives.
     *
     * The panel-level hiding masked a real bug: .config-field sets its own
     * `display: grid`, which outranks the user-agent rule behind the `hidden`
     * attribute, so a row marked hidden stayed on screen. It only showed up
     * where the enclosing panel was *not* hidden too — exactly this case.
     */
    test('an unchanged row is hidden even when its panel stays', async ({ page }) => {
        await openAppearance(page, 'general', [
            ['backgroundType', 'none'],
            ['backgroundOpacity', 1],
        ]);

        // Background type and opacity share a panel. Change one only.
        await page.locator('[data-appearance-bg="gradient"]').click();
        await expect(page.locator(toggle)).toBeEnabled();
        await page.locator(toggle).click();

        const kept = page.locator('[data-appearance-bg="gradient"]');
        await expect(kept).toBeVisible();

        // Its panel survived, so this row is hidden on its own merits.
        const opacityRow = page.locator('.config-field:has([data-appearance-range="backgroundOpacity"])');
        await expect(opacityRow).toBeHidden();
        const panelVisible = await page.evaluate(() => {
            const el = document.querySelector('[data-appearance-range="backgroundOpacity"]');
            const panel = el?.closest('.config-panel');
            return panel ? !panel.hasAttribute('data-appearance-filtered') : null;
        });
        expect(panelVisible, 'the panel was hidden too — this no longer tests row hiding').toBe(true);

        await resetField(page, 'backgroundType', 'none');
    });

    test('a stock tab disables the toggle and says so', async ({ page }) => {
        // Branding's controls, now on Display, at their defaults.
        await openAppearance(page, 'display', [
            ['enableCustomTitle', false],
            ['customTitle', ''],
        ]);

        await expect(page.locator('.config-changed-count'))
            .toHaveText(/at its default/);
        await expect(page.locator(toggle)).toBeDisabled();
    });

    test('the filter survives a tab switch and still hides the right rows', async ({ page }) => {
        // From the default, so the change below is the only thing the filter
        // has to find -- starting from another position would already count.
        await openAppearance(page, 'buttonbar', [
            ['buttonBarPosition', 'bottom-right'],
            ['showIcons', true],
        ]);

        await page.locator('[data-appearance-barpos="side-left"]').click();
        await page.locator(toggle).click();
        await expect(page.locator('[data-behavior-field="showSearchButton"]')).toBeHidden();

        // Display has nothing changed, so arriving there with the filter still
        // on must explain the empty tab rather than just look broken. Its
        // hand-written panel is hidden by the DOM pass, and the schema half
        // renders its own empty note — so assert on the whole tab: no panel
        // left standing, and a message where they were.
        await page.locator('[data-appearance-tab="display"]').click();
        await expect(page.locator('#config-appearance-body .config-panel-empty').first()).toBeVisible();
        await expect(page.locator('#config-appearance-body .config-panel:visible')).toHaveCount(0);

        await page.locator('[data-appearance-tab="buttonbar"]').click();
        await expect(page.locator('[data-appearance-barpos="side-left"]')).toBeVisible();

        await resetField(page, 'buttonBarPosition', 'bottom-right');
    });
});
