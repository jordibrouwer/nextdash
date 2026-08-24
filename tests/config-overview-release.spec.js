// @ts-check
const { test, expect } = require('./fixtures');
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

/**
 * Version-agnostic on purpose: it reads the release the app itself reports, so
 * shipping v1.3.4 does not send someone editing a spec named after v1.3.2.
 */
test.describe('the current release as the reader meets it', () => {
    test('the release number is on the page, once', async ({ page }) => {
        // The update bar reads GitHub; a rate limit or an offline runner would
        // otherwise decide whether this test passes. What is under test is the
        // page, not the network, so the answer is stubbed.
        await page.route('**/api/update-status*', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ current: 'v1.3.3', latest: 'v1.3.3', checkedAt: Date.now(), upToDate: true }),
        }));
        await openOverview(page);

        // The Latest update panel is gone: it repeated the update bar above it
        // and stripped the release notes down to a lead. The version itself is
        // still here, in the update bar, and the stream carries the release row.
        await expect.poll(() => page.locator('.config-overview-act').innerText(), { timeout: 15_000 })
            .toMatch(/1\.3\.3/);
        await expect(page.locator('.config-overview-layout')).not.toContainText('Latest update');
    });

    test('the stream leads with the release and its new setting', async ({ page }) => {
        await openOverview(page);
        const currentTag = String(await page.evaluate(() => window.NEXTDASH_WHATS_NEW_RELEASE)).replace(/^.*-v/, 'v');
        const stream = page.locator('.config-news-stream');
        await expect(stream).toBeVisible({ timeout: 15_000 });
        // The carousel is gone: what was one of forty-nine spotlights is now a
        // dated row beside the release it shipped in.
        await expect(page.locator('.config-new-features-panel')).toHaveCount(0);
        await expect(stream).toContainText(currentTag);

        // A feature row leads where its own button says it does — read from the
        // button rather than named here, so the spec survives the next release
        // putting a different feature at the top.
        const button = page.locator('.config-news-item[data-news-source="feature"] .config-news-go').first();
        const target = JSON.parse(await button.getAttribute('data-overview-go'));
        await button.click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section), { timeout: 10_000 })
            .toBe(target.section);
    });

    test('the modal opens on the current release and reads as prose', async ({ page }) => {
        await openOverview(page);
        const currentTag = String(await page.evaluate(() => window.NEXTDASH_WHATS_NEW_RELEASE)).replace(/^.*-v/, 'v');
        await page.evaluate(() => window.dashboardInstance.config.openWhatsNew());
        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 15_000 });
        await expect(modal).toContainText(currentTag, { timeout: 15_000 });

        const text = await modal.innerText();
        // The modal is written for the reader: no filenames, no identifiers,
        // and no Docs section — release plumbing lives in the changelog.
        expect(text.match(/[\w-]+\.(js|css|go|json)\b/) || []).toEqual([]);
        expect((text.match(/\b\w+\(\)/) || [])).toEqual([]);
        expect(text).not.toMatch(/^Docs$/m);
    });
});
