// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * One checkbox and a delay was not enough control for a card that carries six
 * kinds of information — and the delay it offered (Instant, 200 ms, 400 ms…)
 * was not even a delay the code would accept: anything but 100/150/250 was
 * silently rewritten to 150, so four of the five options did nothing.
 *
 * Three ways to reach the card, a checklist of what it draws, and the card
 * itself drawn beside them from a real bookmark.
 */

async function openDisplayTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 15_000 });
    await page.click('[data-appearance-tab="display"]');
    await page.waitForSelector('[data-behavior-field="linkPreviewMode"]', { timeout: 15_000 });
}

test.describe('the link preview setting', () => {
    test('offers three ways, not a switch', async ({ page }) => {
        await openDisplayTab(page);
        const cards = page.locator('[data-behavior-field="linkPreviewMode"]');
        await expect(cards).toHaveCount(3);

        await page.locator('[data-behavior-field="linkPreviewMode"][data-behavior-value="keyboard"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.linkPreviewMode), { timeout: 10_000 })
            .toBe('keyboard');
        // Everything still reading the old boolean has to agree with the mode,
        // or the command palette and the analytics flag say cards are off while
        // the reader is using them.
        expect(await page.evaluate(() => window.dashboardInstance.settings.showLinkPreviewCards)).toBe(true);
    });

    test('the delays offered are the delays honoured', async ({ page }) => {
        await openDisplayTab(page);
        const values = await page.locator('[data-behavior-field="linkPreviewHoverDelayMs"] option')
            .evaluateAll((els) => els.map((e) => Number(e.value)));
        expect(values).toEqual([100, 150, 250]);
    });

    test('the checklist writes the card’s rows, and the sample follows', async ({ page }) => {
        await openDisplayTab(page);
        const boxes = page.locator('[data-behavior-field="linkPreviewParts"]');
        await expect(boxes).toHaveCount(8);
        // Absent means all, so every box starts ticked.
        expect(await boxes.evaluateAll((els) => els.every((e) => e.checked))).toBe(true);

        const sample = page.locator('[data-preview-sample]');
        await expect(sample).toBeVisible();
        await expect(sample.locator('.bookmark-preview-card-title')).not.toBeEmpty();

        await page.locator('[data-behavior-field="linkPreviewParts"][data-behavior-value="tags"]').uncheck();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.linkPreviewParts), { timeout: 10_000 })
            .not.toContain('tags');
        // The sample is the card itself, so what it shows is what the checklist
        // just decided — no leaving the screen to hover something.
        await expect.poll(() => sample.locator('.bookmark-preview-card-tags').evaluate((el) => el.hidden))
            .toBe(true);
    });
});
