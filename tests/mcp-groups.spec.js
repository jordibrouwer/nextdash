// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Data & backups → Webhooks → MCP access: the tool groups.
 *
 * The master switch opens the endpoint with the bookmark search and add tools;
 * each group beneath it adds more, and none of them can be ticked while the
 * master is off.
 */
async function openMcpPanel(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="webhooks"]').click();
    const panel = page.locator('[data-fold="mcp"]');
    await expect(panel).toBeVisible();
    if (!(await panel.evaluate((el) => el.open))) await panel.locator('summary').click();
    await expect(panel).toHaveAttribute('open', '');
}

const GROUPS = ['mcpBookmarksWrite', 'mcpHealthInbox', 'mcpContainersRead', 'mcpContainersControl'];

async function toolNames(page) {
    const res = await page.request.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    if (res.status() !== 200) return null;
    return (await res.json()).result.tools.map((t) => t.name);
}

test.describe('MCP access tool groups', () => {
    test('the groups cannot be ticked while the master is off', async ({ page }) => {
        await openMcpPanel(page);
        await expect(page.locator('[data-backup-toggle="mcpEnabled"]')).not.toBeChecked();
        for (const key of GROUPS) {
            await expect(page.locator(`[data-backup-toggle="${key}"]`)).toBeDisabled();
        }
    });

    test('Health and Inbox adds its tools and survives a reload', async ({ page }) => {
        await openMcpPanel(page);
        await page.locator('[data-backup-toggle="mcpEnabled"]').check();
        const health = page.locator('[data-backup-toggle="mcpHealthInbox"]');
        await expect(health).toBeEnabled();
        expect(await toolNames(page)).not.toContain('get_health_summary');

        await health.check();
        await expect.poll(() => toolNames(page)).toContain('get_health_summary');

        await openMcpPanel(page);
        await expect(page.locator('[data-backup-toggle="mcpHealthInbox"]')).toBeChecked();

        // Leave nothing open for the next test.
        await page.locator('[data-backup-toggle="mcpHealthInbox"]').uncheck();
        await expect.poll(() => toolNames(page)).not.toContain('get_health_summary');
        await page.locator('[data-backup-toggle="mcpEnabled"]').uncheck();
        await expect.poll(async () => (await page.request.post('/mcp', {
            data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        })).status()).toBe(404);
    });

    test('control is disabled, with its reason, while Docker control is off', async ({ page }) => {
        await openMcpPanel(page);
        await page.locator('[data-backup-toggle="mcpEnabled"]').check();
        const control = page.locator('[data-backup-toggle="mcpContainersControl"]');
        await expect(control).toBeDisabled();
        await expect(page.locator('[data-fold="mcp"]')).toContainText('NEXTDASH_DOCKER_CONTROL');
        await page.locator('[data-backup-toggle="mcpEnabled"]').uncheck();
    });
});
