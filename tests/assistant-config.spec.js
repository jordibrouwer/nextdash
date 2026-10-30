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
            prior = {
                aiEnabled: s.aiEnabled, aiProvider: s.aiProvider, aiBaseURL: s.aiBaseURL, aiModel: s.aiModel,
                mcpBookmarksWrite: s.mcpBookmarksWrite, mcpHealthInbox: s.mcpHealthInbox,
                mcpContainersRead: s.mcpContainersRead, mcpContainersControl: s.mcpContainersControl,
            };
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

    test('the page is four headed panels in order, each with a line of text', async ({ page }) => {
        const fold = await openFold(page);
        await expect(fold.locator('.config-panel-title')).toHaveText(['Turn it on', 'Provider', 'Conversations', 'What it can see and do']);
        const panels = fold.locator('.config-panel');
        await expect(panels).toHaveCount(4);
        for (let i = 0; i < 4; i++) {
            await expect(panels.nth(i).locator('.config-panel-note')).not.toBeEmpty();
        }
        await expect(fold.locator('[data-ai-section="enable"] [data-ai-setting="aiEnabled"]')).toBeVisible();
        await expect(fold.locator('[data-ai-section="provider"] [data-ai-key]')).toBeVisible();
        await expect(fold.locator('[data-ai-section="provider"] [data-ai-action="test"]')).toBeVisible();
        await expect(fold.locator('[data-ai-section="history"] [data-ai-action="delete-all"]')).toBeVisible();
        await expect(fold.locator('[data-ai-section="access"] [data-ai-action="open-mcp"]')).toBeVisible();
    });

    test('every ℹ opens its explanation and closes on Esc and on a click outside', async ({ page }) => {
        const fold = await openFold(page);
        await fold.locator('[data-ai-setting="aiProvider"]').selectOption('compatible');
        await expect(fold.locator('[data-ai-setting="aiBaseURL"]')).toBeVisible();
        const expected = {
            aiEnabled: 'Turn the assistant on', aiProvider: 'Provider', aiKey: 'API key', aiBaseURL: 'Server address',
            aiModel: 'Model', aiTest: 'Test connection', aiHistoryMax: 'Conversations to keep',
            aiHistoryDays: 'Days to keep them', aiDeleteAll: 'Delete all conversations', aiAccess: 'What it can see and do',
        };
        const modal = page.locator('#app-modal.show .modal');
        for (const [field, title] of Object.entries(expected)) {
            const btn = fold.locator(`[data-info-field="${field}"]`);
            await expect(btn).toHaveCount(1);
            await expect(btn).toHaveAttribute('aria-label', 'More info');
            await btn.click();
            await expect(modal).toBeVisible();
            await expect(page.locator('#modal-title')).toHaveText(title);
            expect((await page.locator('#app-modal .modal-text').innerText()).trim().length).toBeGreaterThan(60);
            await page.keyboard.press('Escape');
            await expect(modal).toBeHidden();
        }
        // Outside click: the backdrop.
        await fold.locator('[data-info-field="aiKey"]').click();
        await expect(modal).toBeVisible();
        await page.mouse.click(3, 3);
        await expect(modal).toBeHidden();
    });

    test('the explanations state what the server does', async ({ page }) => {
        const fold = await openFold(page);
        const text = async (field) => {
            await fold.locator(`[data-info-field="${field}"]`).click();
            await expect(page.locator('#app-modal.show .modal')).toBeVisible();
            const t = await page.locator('#app-modal .modal-text').innerText();
            await page.keyboard.press('Escape');
            await expect(page.locator('#app-modal.show .modal')).toBeHidden();
            return t;
        };
        expect(await text('aiModel')).toContain('claude-sonnet-5-5');
        expect(await text('aiModel')).toContain('gpt-5.6-terra');
        expect(await text('aiKey')).toContain('ai-secrets.json');
        expect(await text('aiAccess')).toMatch(/8 rounds.*20 lookups.*two minutes/s);
        expect(await text('aiHistoryMax')).toContain('50');
        expect(await text('aiHistoryDays')).toContain('90');
    });

    test('Open MCP access goes to the MCP panel, open', async ({ page }) => {
        const fold = await openFold(page);
        await fold.locator('[data-ai-action="open-mcp"]').click();
        await expect(page).toHaveURL(/#config\/data-backups\/webhooks$/);
        const mcp = page.locator('[data-fold="mcp"]');
        await expect(mcp).toBeVisible();
        await expect.poll(() => mcp.evaluate((el) => el.open)).toBe(true);
        await expect(page.locator('[data-ai-panel]')).toHaveCount(0);
    });

    test('the group chips show the current MCP switches', async ({ page }) => {
        const res = await page.request.get('/api/settings');
        await page.request.post('/api/settings', {
            data: { ...(await res.json()), mcpBookmarksWrite: true, mcpHealthInbox: false, mcpContainersRead: true, mcpContainersControl: false },
            headers: AUTH,
        });
        const fold = await openFold(page);
        const state = (key) => fold.locator(`[data-ai-group="${key}"]`);
        await expect(fold.locator('[data-ai-group]')).toHaveCount(4);
        await expect(state('mcpBookmarksWrite')).toHaveAttribute('data-ai-group-on', 'true');
        await expect(state('mcpBookmarksWrite')).toContainText('On');
        await expect(state('mcpHealthInbox')).toHaveAttribute('data-ai-group-on', 'false');
        await expect(state('mcpHealthInbox')).toContainText('Off');
        await expect(state('mcpContainersRead')).toHaveAttribute('data-ai-group-on', 'true');
        await expect(state('mcpContainersControl')).toHaveAttribute('data-ai-group-on', 'false');
    });

    test('the readiness line says what is missing and follows the switch', async ({ page }) => {
        const fold = await openFold(page);
        const line = fold.locator('[data-ai-ready-line]');
        const sw = fold.locator('[data-ai-setting="aiEnabled"]');
        await sw.uncheck();
        await expect(line).toContainText('Turn the assistant on to use it');
        // The fields are not locked while it is off: a key can be saved first.
        await expect(fold.locator('[data-ai-key]')).toBeEnabled();
        await sw.check();
        await expect(line).not.toContainText('Turn the assistant on');
        await fold.locator('[data-ai-setting="aiProvider"]').selectOption('compatible');
        await expect(line).toContainText('server address is missing');
        await fold.locator('[data-ai-setting="aiBaseURL"]').fill('http://ollama.lan:11434/v1');
        await fold.locator('[data-ai-setting="aiBaseURL"]').blur();
        await expect(line).toContainText('model name is missing');
        await fold.locator('[data-ai-setting="aiModel"]').fill('llama3');
        await fold.locator('[data-ai-setting="aiModel"]').blur();
        await expect(line).toContainText('Ready');
        // Let the last save land, or it overwrites what afterEach puts back.
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).aiModel).toBe('llama3');
    });

    test('a key that fails to save is cleared from the field too', async ({ page }) => {
        const fold = await openFold(page);
        await page.route('**/api/ai/key', (route) => (route.request().method() === 'PUT'
            ? route.fulfill({ status: 500, body: 'no' }) : route.fallback()));
        const input = fold.locator('[data-ai-key]');
        await input.fill('sk-will-fail-0123456789');
        await fold.locator('[data-ai-action="save-key"]').click();
        await expect(input).toHaveValue('');
        expect(await page.content()).not.toContain('sk-will-fail-0123456789');
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
