// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * Behavior -> Privacy & sync -> Assistant: the switch, the provider, the key
 * (write-only), the test button, and the MCP groups the assistant shares.
 */
const AUTH = { 'X-NextDash-Token': WRITE_TOKEN };

async function openFold(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.behaviorTab = 'privacy';
        return c.openConfigView('behavior');
    });
    const fold = page.locator('[data-fold="assistant"]');
    await expect(fold).toBeVisible();
    if (!(await fold.evaluate((el) => el.open))) await fold.locator('summary').click();
    await expect(fold).toHaveAttribute('open', '');
    return fold;
}

test.describe('Assistant settings', () => {
    // One server, one settings file: these tests change the same keys.
    test.describe.configure({ mode: 'serial' });

    test.afterEach(async ({ page }) => {
        // Put back what a test may have changed, whether or not it passed.
        const res = await page.request.get('/api/settings');
        if (res.ok()) {
            const s = await res.json();
            s.aiEnabled = false;
            s.aiProvider = 'anthropic';
            s.aiBaseURL = '';
            s.aiModel = '';
            await page.request.post('/api/settings', { data: s, headers: AUTH });
        }
        for (const p of ['anthropic', 'openai', 'compatible']) {
            await page.request.delete(`/api/ai/key?provider=${p}`, { headers: AUTH });
        }
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
