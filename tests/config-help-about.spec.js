// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The About tab of config help.
 *
 * It is the one place in the app that says what nextDash is and where it comes
 * from, and all three of those things — the wordmark, the project site, the
 * author's site — are markup that only appears when someone opens this tab. A
 * logo that 404s still renders as an alt-text stub, so the image is checked for
 * having actually decoded rather than for being in the DOM.
 */

async function openAbout(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForSelector('[data-help-tab="about"]', { timeout: 15_000 });
    await page.locator('[data-help-tab="about"]').click();
    await page.waitForSelector('#config-help-body .config-panel', { timeout: 15_000 });
}

test.describe('config help — about', () => {
    test('shows the wordmark, decoded rather than merely present', async ({ page }) => {
        await openAbout(page);

        const mark = page.locator('.help-about-mark img');
        await expect(mark).toBeVisible();
        await expect(mark).toHaveAttribute('alt', 'nextDash');

        const state = await mark.evaluate((img) => ({
            complete: img.complete,
            natural: img.naturalWidth,
            width: Math.round(img.getBoundingClientRect().width),
        }));
        expect(state.complete).toBe(true);
        // A broken src leaves naturalWidth at 0 while the element still lays out.
        expect(state.natural).toBeGreaterThan(0);
        expect(state.width).toBeGreaterThan(100);
    });

    test('offers both addresses, and each only once', async ({ page }) => {
        await openAbout(page);

        const body = page.locator('#config-help-body');
        const hrefs = await body.locator('a[href]').evaluateAll((links) =>
            links.map((a) => a.getAttribute('href') || ''));

        expect(hrefs.filter((h) => h.includes('nextdash.cc'))).toHaveLength(1);
        expect(hrefs.filter((h) => h.includes('jordibrw.nl'))).toHaveLength(1);
        expect(hrefs.some((h) => h.includes('github.com/jordibrouwer/nextDash'))).toBe(true);

        // Opening someone else's site in this tab would take the dashboard with
        // it, and rel is what keeps the new tab from reaching back.
        for (const site of ['nextdash.cc', 'jordibrw.nl']) {
            const link = body.locator(`a[href*="${site}"]`);
            await expect(link).toHaveAttribute('target', '_blank');
            await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
    });

    test('the prose names both sites, in whichever language is loaded', async ({ page }) => {
        await openAbout(page);

        const prose = page.locator('#config-help-body .config-help-prose').first();
        await expect(prose).toContainText('nextdash.cc');
        await expect(prose).toContainText('jordibrw.nl');
        // A missing locale key renders as its own name; the tab would still look
        // populated.
        await expect(prose).not.toContainText('config.helpAboutBody');
    });
});
