// The highlights of v1.23.0: the assistant with a proposal waiting, and the MCP access panel
// with its tool groups. See tests/whats-new-media.spec.js.
//
// The assistant is off in the demo, so this plan needs a copy of the demo data that has it on:
// aiEnabled, a placeholder key in ai-secrets.json and a conversation in ai-conversations.json,
// as tests/manual-screenshots-v1-23-ai.spec.js writes them for its shots.
module.exports = {
    shots: [
        {
            slug: 'assistant',
            kind: 'image',
            alt: 'The assistant panel: an answer about three links that are down, with a tag change and a deletion waiting under it, each with Apply and Skip',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('.assistant-panel').first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
                await page.evaluate(() => { document.body.focus(); });
                await page.keyboard.press('=');
                await page.keyboard.press('Enter');
                const panel = page.locator('.assistant-panel');
                await panel.waitFor();
                await panel.getByRole('button', { name: /^Which of my links are down\?/ }).click();
                await panel.locator('[data-ai-thread]').getByText('Three bookmarks failed').waitFor();
                // Pacing for the capture, not a condition: the panel finishes sliding in.
                await page.waitForTimeout(900);
            },
        },
        {
            slug: 'mcp-access',
            kind: 'image',
            alt: 'MCP access under Data & backups: the switch for the address and four groups of tools, two of them switched on',
            viewport: { width: 1280, height: 1100 },
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
                await page.locator('.config-link-anchor').click();
                await page.locator('[data-config-section="data-backups"]').click();
                await page.locator('[data-db-tab="webhooks"]').click();
                const panel = page.locator('[data-fold="mcp"]');
                await panel.waitFor();
                if (!(await panel.evaluate((el) => el.open))) await panel.locator('summary').click();
                await panel.locator('.config-mcp-address').evaluate((el) => { el.textContent = 'http://your-host:8080/mcp'; });
                // Pacing for the capture, not a condition: the fold finishes opening.
                await page.waitForTimeout(700);
            },
            target: (page) => page.locator('[data-fold="mcp"]').first(),
        },
    ],
};
