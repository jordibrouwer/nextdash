// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady, openConfigPanel } = require('./e2e-helpers');

/**
 * Chip groups: the "Show this" switches of the action bar, the header, the
 * category header, the row status and the date line are rows of
 * `button[aria-pressed]`, each writing its own setting.
 */
async function openTab(page, tab) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto('/');
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
    await expect(page.locator('#config-appearance-body')).toBeVisible();
}

const chip = (page, field) => page.locator(`button[data-behavior-field="${field}"]`);
const settingsSaved = (page) => page.evaluate(() => {
    const c = window.dashboardInstance.config;
    return (c._module || c)._settingsSaveChain;
});
const snapshot = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.dashboardInstance.settings)));

test.describe('chip groups', () => {
    test('a chip is a button that writes exactly its own field and survives a reload', async ({ page }) => {
        await openTab(page, 'buttonbar');
        const search = chip(page, 'showSearchButton');
        await expect(search).toBeVisible();
        const was = (await search.getAttribute('aria-pressed')) === 'true';
        const before = await snapshot(page);

        await search.click();
        await expect(search).toHaveAttribute('aria-pressed', was ? 'false' : 'true');
        await settingsSaved(page);
        const after = await snapshot(page);
        const moved = Object.keys({ ...before, ...after })
            .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        expect(moved).toEqual(['showSearchButton']);

        await openTab(page, 'buttonbar');
        await expect(chip(page, 'showSearchButton')).toHaveAttribute('aria-pressed', was ? 'false' : 'true');

        // The chrome special reached the page without a reload of its own.
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-show-search-button')))
            .toBe(String(!was));
        await chip(page, 'showSearchButton').click();
        await expect(chip(page, 'showSearchButton')).toHaveAttribute('aria-pressed', was ? 'true' : 'false');
        await settingsSaved(page);
    });

    test('chips are in the tab order and Space and Enter toggle them', async ({ page }) => {
        await openTab(page, 'buttonbar');
        const first = chip(page, 'showAddBookmarkButton');
        await first.focus();
        const was = (await first.getAttribute('aria-pressed')) === 'true';

        await page.keyboard.press('Space');
        await expect(chip(page, 'showAddBookmarkButton')).toHaveAttribute('aria-pressed', was ? 'false' : 'true');
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-behavior-field')))
            .toBe('showAddBookmarkButton');
        await page.keyboard.press('Enter');
        await expect(chip(page, 'showAddBookmarkButton')).toHaveAttribute('aria-pressed', was ? 'true' : 'false');

        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-behavior-field')))
            .toBe('showAddBookmarkButton');
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-behavior-field')))
            .toBe('showSearchButton');
        await settingsSaved(page);
    });

    test('one reset for the group puts back only the chips that differ', async ({ page }) => {
        await openTab(page, 'display');
        await openConfigPanel(page, chip(page, 'showStatus'));
        // Row status: online/offline and ping times ship on.
        const status = chip(page, 'showStatus');
        const ping = chip(page, 'showPing');
        await expect(status).toHaveAttribute('aria-pressed', 'true');
        await expect(ping).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-reset-group]')).toHaveCount(0);

        await ping.click();
        await expect(ping).toHaveAttribute('aria-pressed', 'false');
        const reset = page.locator('[data-reset-group]');
        await expect(reset).toHaveCount(1);
        await expect(reset).toHaveAttribute('data-reset-group', 'showPing');

        await reset.click();
        await expect(chip(page, 'showPing')).toHaveAttribute('aria-pressed', 'true');
        await expect(chip(page, 'showStatus')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-reset-group]')).toHaveCount(0);
        await settingsSaved(page);
    });

    test('the filter matches a chip label and Only changed counts a changed chip', async ({ page }) => {
        await openTab(page, 'display');
        await page.locator('[data-settings-filter]').first().fill('ping times');
        await expect(chip(page, 'showPing')).toBeVisible();
        await expect(page.locator('button[data-behavior-type="chip"]')).toHaveCount(1);
        expect(await page.evaluate(() =>
            window.dashboardInstance.config.countTabMatches('appearance', 'display', 'ping times'))).toBe(1);

        await page.locator('[data-settings-filter]').first().fill('');
        await openConfigPanel(page, chip(page, 'showStatusLoading'));
        await chip(page, 'showStatusLoading').click();
        await settingsSaved(page);
        await expect(page.locator('.config-changed-count')).toContainText('differ from the default');
        await page.locator('.config-view-head [data-config-action="toggle-changed"]').click();
        await expect(page.locator('button[data-behavior-type="chip"]')).toHaveCount(1);
        await expect(chip(page, 'showStatusLoading')).toBeVisible();
        expect(await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return c.countTabMatches('appearance', 'display', '');
        })).toBe(1);

        await page.locator('.config-view-head [data-config-action="toggle-changed"]').click();
        await openConfigPanel(page, chip(page, 'showStatusLoading'));
        await chip(page, 'showStatusLoading').click();
        await settingsSaved(page);
    });

    test('Find settings lands on the chip', async ({ page }) => {
        await openTab(page, 'general');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await page.locator('#config-settings-jump-filter').fill('Show ping times');
        await page.locator('.config-settings-jump-result', { hasText: 'Show ping times' }).first().click();
        await expect(page.locator('[data-appearance-tab="display"]')).toHaveAttribute('aria-selected', 'true');
        // The jump addresses the control by its field, which is the chip.
        await expect.poll(() => page.evaluate(() => {
            const sel = window.dashboardInstance.config.settingsJumpControlSelector('showPing');
            return sel ? document.querySelector(sel)?.tagName : null;
        })).toBe('BUTTON');
        await expect(chip(page, 'showPing')).toBeVisible();
    });

    test('one ℹ for the group lists what each chip does', async ({ page }) => {
        await openTab(page, 'buttonbar');
        const info = page.locator('[data-info-group]').first();
        await expect(info).toBeVisible();
        const fields = String(await info.getAttribute('data-info-group')).split(',');
        expect(fields.length).toBeGreaterThan(0);
        await info.click();
        const modal = page.locator('#app-modal');
        await expect(modal.locator('.modal-text strong')).toHaveCount(fields.length);
        await expect(modal).toContainText(String(await info.getAttribute('data-info-group-title')));
    });

    test('the link preview fields are chips over one array', async ({ page }) => {
        await openTab(page, 'previews');
        const chips = page.locator('button[data-behavior-field="linkPreviewParts"]');
        const count = await chips.count();
        expect(count).toBeGreaterThan(1);
        await page.locator('button[data-behavior-field="linkPreviewParts"][data-behavior-value="note"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.linkPreviewParts))
            .toHaveLength(count - 1);
        expect(await page.evaluate(() => window.dashboardInstance.settings.linkPreviewParts)).not.toContain('note');
        await page.locator('.config-field-affordances [data-reset-field="linkPreviewParts"]').click();
        await expect(page.locator('button[data-behavior-field="linkPreviewParts"][aria-pressed="true"]')).toHaveCount(count);
        await settingsSaved(page);
    });
});
