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
    test('Latest update reports the new release', async ({ page }) => {
        await openOverview(page);
        // The panel fetches the index, so it is a poll rather than a read.
        await expect.poll(() => page.locator('.config-overview-layout').innerText(), { timeout: 15_000 })
            .toContain('v1.3.2');
    });

    test('the spotlight leads with the preview card and lands on its setting', async ({ page }) => {
        await openOverview(page);
        const panel = page.locator('.config-new-features-panel');
        await expect(panel).toBeVisible({ timeout: 15_000 });
        // Newest first: the release's own feature is the one a reader arriving
        // at the overview is shown.
        await expect(panel.locator('.config-feature-spotlight-title')).toContainText(/hover card/i);
        // Copy, not locale keys.
        await expect(panel).not.toContainText('config.overviewNewFeature');

        await panel.locator('[data-overview-go]').click();
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
