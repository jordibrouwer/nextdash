// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A release is not published until the three places a reader meets it agree:
 * the version the overview reports, the spotlight that says what is new, and
 * the What's new modal. This is that check for v1.3.2, done through the views
 * rather than by reading the files.
 */

async function openOverview(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.waitForSelector('.config-overview-layout', { timeout: 15_000 });
}

test.describe('v1.3.2 as the reader meets it', () => {
    test('the release number is on the page, once', async ({ page }) => {
        await openOverview(page);
        // The Latest update panel is gone: it repeated the update bar above it
        // and stripped the release notes down to a lead. The version itself is
        // still here, in the update bar, and Help carries the full heading.
        await expect.poll(() => page.locator('.config-overview-act').innerText(), { timeout: 15_000 })
            .toMatch(/1\.3\.2/);
        await expect(page.locator('.config-overview-layout')).not.toContainText('Latest update');
    });

    test('the stream leads with the release and its new setting', async ({ page }) => {
        await openOverview(page);
        const stream = page.locator('.config-news-stream');
        await expect(stream).toBeVisible({ timeout: 15_000 });
        // The carousel is gone: what was one of forty-nine spotlights is now a
        // dated row beside the release it shipped in.
        await expect(page.locator('.config-new-features-panel')).toHaveCount(0);
        await expect(stream).toContainText('v1.3.2');
        await expect(stream).toContainText(/hover card/i);

        // And it still leads where it always did.
        await page.locator('.config-news-item[data-news-source="feature"] .config-news-go').first().click();
        await expect.poll(() => page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return `${c.section}/${c.appearanceTab}`;
        }), { timeout: 10_000 }).toBe('appearance/display');
        await expect(page.locator('[data-behavior-field="linkPreviewMode"]').first()).toBeVisible();
    });

    test('the modal opens on v1.3.2 and reads as prose', async ({ page }) => {
        await openOverview(page);
        await page.evaluate(() => window.dashboardInstance.config.openWhatsNew());
        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 15_000 });
        await expect(modal).toContainText('v1.3.2', { timeout: 15_000 });

        const text = await modal.innerText();
        // The modal is written for the reader: no filenames, no identifiers,
        // and no Docs section — release plumbing lives in the changelog.
        expect(text.match(/[\w-]+\.(js|css|go|json)\b/) || []).toEqual([]);
        expect((text.match(/\b\w+\(\)/) || [])).toEqual([]);
        expect(text).not.toMatch(/^Docs$/m);
    });
});
