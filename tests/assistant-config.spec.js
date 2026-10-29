// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * Config -> Assistant -> Settings: the switch, the provider, the key
 * (write-only), the test button, and the MCP groups the assistant shares. The
 * page is a section of its own, under Status page in the rail, with one tab.
 */
const AUTH = { 'X-NextDash-Token': WRITE_TOKEN };

async function openApp(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
}

/** Opens Config -> Assistant by its address and returns the panel. */
async function openFold(page, hash = '#config/assistant/settings') {
    await openApp(page);
    await page.evaluate((h) => { location.hash = h; }, hash);
    const fold = page.locator('[data-ai-panel]');
    await expect(fold).toBeVisible();
    return fold;
}

test.describe('Assistant settings', () => {
    // One server, one settings file: these tests change the same keys.
    test.describe.configure({ mode: 'serial' });

    /** What the data folder held before, put back afterwards. */
    let prior = null;
    let keysBefore = {};

    test.beforeEach(async ({ page }) => {
        const res = await page.request.get('/api/settings');
        if (res.ok()) {
            const s = await res.json();
            prior = { aiEnabled: s.aiEnabled, aiProvider: s.aiProvider, aiBaseURL: s.aiBaseURL, aiModel: s.aiModel };
        }
        keysBefore = (await (await page.request.get('/api/ai/key')).json()).keySet || {};
    });

    test.afterEach(async ({ page }) => {
        // Put back what a test may have changed, whether or not it passed.
        const res = await page.request.get('/api/settings');
        if (res.ok() && prior) {
            await page.request.post('/api/settings', { data: { ...(await res.json()), ...prior }, headers: AUTH });
        }
        // Only the keys a test stored; a key that was there stays.
        for (const p of ['anthropic', 'openai', 'compatible']) {
            if (!keysBefore[p]) await page.request.delete(`/api/ai/key?provider=${p}`, { headers: AUTH });
        }
    });

    test('the section sits under Status page in the rail, new, with one tab in the same place as Status page', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('status-page'));
        const order = await page.evaluate(() =>
            [...document.querySelectorAll('[data-config-section]')].map((b) => b.getAttribute('data-config-section')));
        const at = order.indexOf('status-page');
        expect(at).toBeGreaterThan(-1);
        expect(order[at + 1]).toBe('assistant');
        const item = page.locator('[data-config-section="assistant"]');
        await expect(item).toHaveAttribute('data-config-new', 'new');
        await expect(item).toContainText('Assistant');

        const stripTop = () => page.evaluate(() => {
            const head = document.querySelector('.config-view-head').getBoundingClientRect();
            const strip = document.querySelector('#config-view-body .config-subtabs').getBoundingClientRect();
            return Math.round(strip.top - head.bottom);
        });
        await page.waitForSelector('#config-view-body .config-subtabs');
        const onStatus = await stripTop();
        await item.click();
        await expect(page.locator('[data-ai-panel]')).toBeVisible();
        const tabs = page.locator('#config-view-body .config-subtabs .config-subtab');
        await expect(tabs).toHaveCount(1);
        await expect(tabs.first()).toHaveText('Settings');
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
        expect(Math.abs((await stripTop()) - onStatus)).toBeLessThanOrEqual(2);
        await expect(page).toHaveURL(/#config\/assistant\/settings$/);
    });

    test('#config/assistant and #config/assistant/settings both open the page', async ({ page }) => {
        await openFold(page, '#config/assistant');
        await expect(page.locator('[data-config-section="assistant"]')).toHaveAttribute('aria-selected', 'true');
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await expect(page.locator('[data-ai-panel]')).toHaveCount(0);
        await page.evaluate(() => { location.hash = '#config/assistant/settings'; });
        await expect(page.locator('[data-ai-panel]')).toBeVisible();
    });

    test('Behavior -> Privacy & sync no longer holds the assistant', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.behaviorTab = 'privacy';
            return c.openConfigView('behavior');
        });
        await expect(page.locator('[data-behavior-action="reset-onboarding"]')).toBeVisible();
        await expect(page.locator('[data-fold="assistant"], [data-ai-panel], [data-ai-setting]')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.config._assistantFoldOpen)).toBeUndefined();
    });

    test('openAssistantFold lands on the page', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.dashboardInstance.config.openAssistantFold());
        await expect(page.locator('[data-ai-panel]')).toBeVisible();
        await expect(page).toHaveURL(/#config\/assistant\/settings$/);
    });

    test('the assistant settings are found by the settings search and jump to the page', async ({ page }) => {
        await openApp(page);
        // The config module is loaded on first open; the index is its.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        const fields = await page.evaluate(() => window.dashboardInstance.config.settingsJumpFieldEntries()
            .filter((e) => e.section === 'assistant').map((e) => e.field));
        for (const f of ['aiEnabled', 'aiProvider', 'aiBaseURL', 'aiModel', 'aiKey', 'aiHistoryMax', 'aiHistoryDays', 'aiDeleteAll', 'aiTest']) {
            expect(fields).toContain(f);
        }
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return c.activateSettingsJumpEntry(c.settingsJumpFieldEntries().find((e) => e.field === 'aiModel'));
        });
        await expect(page.locator('[data-ai-panel]')).toBeVisible();
        await expect(page.locator('[data-ai-setting="aiModel"]')).toBeFocused();
    });

    test('the switch and the compatible provider survive a reload', async ({ page }) => {
        const fold = await openFold(page);
        const url = fold.locator('[data-ai-setting="aiBaseURL"]');
        await expect(url).toHaveCount(0);
        await fold.locator('[data-ai-setting="aiEnabled"]').check();
        await fold.locator('[data-ai-setting="aiProvider"]').selectOption('compatible');
        await expect(url).toBeVisible();
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).aiProvider).toBe('compatible');

        const again = await openFold(page);
        await expect(again.locator('[data-ai-setting="aiEnabled"]')).toBeChecked();
        await expect(again.locator('[data-ai-setting="aiProvider"]')).toHaveValue('compatible');
        await expect(again.locator('[data-ai-setting="aiBaseURL"]')).toBeVisible();
    });

    test('a saved key is cleared from the field and never echoed back', async ({ page }) => {
        const secret = 'sk-test-secret-0123456789';
        const bodies = [];
        page.on('response', async (r) => {
            if (!r.url().includes('/api/ai/')) return;
            bodies.push(await r.text().catch(() => ''));
        });
        const fold = await openFold(page);
        const input = fold.locator('[data-ai-key]');
        await expect(fold).toContainText('No key saved.');
        await input.fill(secret);
        await fold.locator('[data-ai-action="save-key"]').click();
        await expect(fold).toContainText('Key saved.');
        await expect(input).toHaveValue('');
        expect(await page.content()).not.toContain(secret);
        expect(bodies.join('\n')).not.toContain(secret);
        await fold.locator('[data-ai-action="remove-key"]').click();
        await expect(fold).toContainText('No key saved.');
    });

    test('Test connection without a key says why', async ({ page }) => {
        const fold = await openFold(page);
        await fold.locator('[data-ai-setting="aiEnabled"]').check();
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).aiEnabled).toBe(true);
        await fold.locator('[data-ai-action="test"]').click();
        await expect(fold.locator('[role="status"]')).toContainText(/key/i);
    });

    test('with the assistant on and MCP off, the MCP groups can be ticked', async ({ page }) => {
        const fold = await openFold(page);
        await fold.locator('[data-ai-setting="aiEnabled"]').check();
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).aiEnabled).toBe(true);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.locator('[data-db-tab="webhooks"]').click();
        const mcp = page.locator('[data-fold="mcp"]');
        if (!(await mcp.evaluate((el) => el.open))) await mcp.locator('summary').click();
        await expect(page.locator('[data-backup-toggle="mcpEnabled"]')).not.toBeChecked();
        await expect(page.locator('[data-backup-toggle="mcpHealthInbox"]')).toBeEnabled();
        await expect(mcp).toContainText('The assistant uses these switches too.');
    });
});
