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
    test('splits into eleven panels, each with real prose', async ({ page }) => {
        await openHealthHelp(page);

        const body = page.locator('#config-help-body');
        // Availability, the list, the numbers, expectations, certificates,
        // drift, maintenance windows, notifications, the walkthrough, the
        // inbox, and working through it.
        await expect(body.locator('.config-panel')).toHaveCount(11);

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

    test('covers drift detection: all three kinds, and how a baseline is set', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Watch for redirects, retitling and rewrites/i);
        await expect(body).toContainText(/baseline/i);
        await expect(body).toContainText(/Redirect drift/i);
        await expect(body).toContainText(/Title drift/i);
        await expect(body).toContainText(/Content drift/i);
        // The row badges the prose says to expect.
        await expect(body).toContainText(/Moved/);
        await expect(body).toContainText(/Retitled/);
        await expect(body).toContainText(/Changed/);
    });

    test('covers maintenance windows: what they exclude and what they do not', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Maintenance windows/i);
        await expect(body).toContainText(/past midnight/i);
        // The nuance that matters: checks still run, only the alerting is held back.
        await expect(body).toContainText(/heartbeat still records/i);
    });

    test('covers every notification preset and the test-send button', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        for (const service of ['Slack', 'Discord', 'Telegram', 'Pushover', 'ntfy', 'Raw JSON']) {
            await expect(body, `mentions ${service}`).toContainText(service);
        }
        await expect(body).toContainText(/Chat ID/i);
        await expect(body).toContainText(/application token/i);
        await expect(body).toContainText(/user key/i);
        await expect(body).toContainText(/Send test alert/i);
    });

    test('the walkthrough ties every setting to one worked example', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        const walkthrough = body.locator('.config-panel', {
            has: page.locator('.config-panel-title', { hasText: 'Setting up one monitored bookmark' }),
        });
        await expect(walkthrough).toBeVisible();
        const text = (await walkthrough.textContent()) || '';
        // Every setting introduced earlier in the tab shows up again here, tied
        // to a concrete reason rather than repeated in the abstract.
        expect(text).toMatch(/Monitor/);
        expect(text).toMatch(/interval/i);
        expect(text).toMatch(/Status codes/i);
        expect(text).toMatch(/must contain/i);
        expect(text).toMatch(/drift/i);
        expect(text).toMatch(/[Mm]aintenance/);
        expect(text).toMatch(/[Aa]lert after/);
        expect(text).toMatch(/[Tt]est alert/);
        expect(text.trim().length).toBeGreaterThan(1500);
    });

    test('every language renders translated prose rather than keys', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // The English titles, so a language that silently failed to load — and
        // therefore still shows English — is caught rather than passing.
        // "Inbox" is deliberately absent: it is the same word in English and
        // Dutch, so asserting it is gone would fail on a correct nl translation.
        const english = ['Availability & health', 'Working through the list',
            'Uptime, trends & statistics', 'Working through the inbox'];

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
            await expect(body.locator('.config-panel'), `${lang} panel count`).toHaveCount(11);
            await expect(body, `${lang} has no untranslated keys`).not.toContainText('config.help');

            const titles = (await body.locator('.config-panel-title').allTextContents())
                .map((t) => t.trim());
            expect(titles, `${lang} titles are translated`).not.toEqual(english);
            // Every English title must be gone, not just the list as a whole
            // differing — one title left in English would otherwise pass.
            for (const title of english) {
                expect(titles, `${lang} still shows the English "${title}"`).not.toContain(title);
            }

            // Each body carries real prose, not an empty string falling back to
            // the (deliberately blank) English default.
            for (const prose of await body.locator('.config-help-prose').all()) {
                expect((await prose.textContent())?.trim().length,
                    `${lang} prose length`).toBeGreaterThan(200);
            }
        }
    });
});
