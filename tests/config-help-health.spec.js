// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The Health tab of config help.
 *
 * The prose is translator-supplied HTML dropped into the page unescaped, so the
 * risks are a missing key rendering as `config.helpFoo` and markup that never
 * closes. Both are invisible until someone opens the tab, which is why they are
 * asserted here rather than trusted.
 */

async function openHealthHelp(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForSelector('[data-help-tab="health"]', { timeout: 15_000 });
    await page.locator('[data-help-tab="health"]').click();
    await page.waitForSelector('#config-help-body .config-panel', { timeout: 15_000 });
}

test.describe('config help — health', () => {
    test('splits into four panels, each with real prose', async ({ page }) => {
        await openHealthHelp(page);

        const body = page.locator('#config-help-body');
        // Availability, the list, the numbers, and the inbox.
        await expect(body.locator('.config-panel')).toHaveCount(4);

        // A missing key renders as the key itself; nothing here may look like one.
        await expect(body).not.toContainText('config.help');

        for (const prose of await body.locator('.config-help-prose').all()) {
            // Rendered as markup, not shown as escaped tags.
            await expect(prose.locator('p').first()).toBeVisible();
            expect((await prose.textContent())?.trim().length).toBeGreaterThan(200);
            await expect(prose).not.toContainText('<p>');
        }
    });

    test('covers the collection-wide statistics, not just per-row ones', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        // The panel above the Monitored list.
        await expect(body).toContainText(/All monitors/i);
        await expect(body).toContainText(/Least available/i);
        await expect(body).toContainText(/Slower than last week/i);
        await expect(body).toContainText(/Outages/i);

        // The trend, and the reason its axis is fixed.
        await expect(body).toContainText(/0–100/);
        await expect(body).toContainText(/90 days/i);

        // The interval picker on the row.
        await expect(body).toContainText(/Check interval/i);

        // The tiles that sound alike are told apart.
        await expect(body).toContainText(/Stale/i);
        await expect(body).toContainText(/Unused/i);
    });

    test('every language renders translated prose rather than keys', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // The English titles, so a language that silently failed to load — and
        // therefore still shows English — is caught rather than passing.
        const english = ['Availability & health', 'Working through the list',
            'Uptime, trends & statistics', 'Inbox'];

        for (const lang of ['nl', 'de', 'fr']) {
            await page.evaluate(async (code) => {
                const d = window.dashboardInstance;
                await d.language.loadTranslations(code);
                d.config.openConfigView('help');
                d.config.helpTab = 'health';
                d.config.render?.();
            }, lang);
            await page.waitForSelector('#config-help-body .config-panel', { timeout: 15_000 });

            const body = page.locator('#config-help-body');
            await expect(body.locator('.config-panel'), `${lang} panel count`).toHaveCount(4);
            await expect(body, `${lang} has no untranslated keys`).not.toContainText('config.help');

            const titles = await body.locator('.config-panel-title').allTextContents();
            expect(titles.map((t) => t.trim()), `${lang} titles are translated`).not.toEqual(english);

            // Each body carries real prose, not an empty string falling back to
            // the (deliberately blank) English default.
            for (const prose of await body.locator('.config-help-prose').all()) {
                expect((await prose.textContent())?.trim().length,
                    `${lang} prose length`).toBeGreaterThan(200);
            }
        }
    });
});
