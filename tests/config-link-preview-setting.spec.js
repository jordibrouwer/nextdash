// @ts-check
const { test, expect } = require('./fixtures');
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

test.describe('the command palette and the mode', () => {
    test(':preview off and on again keeps keyboard-only', async ({ page }) => {
        await openDisplayTab(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.linkPreviewMode = 'keyboard';
            d.settings.showLinkPreviewCards = true;
        });

        // `:preview` is a switch, and a switch has to put back what it took
        // away — flipping off and on used to move someone who wanted the card
        // only on Shift + V onto hover.
        const commands = page.evaluate(() => {
            const d = window.dashboardInstance;
            const search = d.searchComponent || d.search;
            const sc = search.commandsComponent;
            sc.setPreviewCardsVisibility(d, false);
            const off = d.settings.linkPreviewMode;
            sc.setPreviewCardsVisibility(d, true);
            return { off, on: d.settings.linkPreviewMode };
        });
        expect(await commands).toEqual({ off: 'off', on: 'keyboard' });
    });
});

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

    test('the delays offered are the delays honoured, and Calm is the default', async ({ page }) => {
        await openDisplayTab(page);
        const values = await page.locator('[data-behavior-field="linkPreviewHoverDelayMs"] option')
            .evaluateAll((els) => els.map((e) => Number(e.value)));
        expect(values).toEqual([100, 150, 250]);

        // A card that opens the moment the pointer crosses a row opens on rows
        // you were only passing over, so the calm end is where it starts.
        const meta = await page.evaluate(() =>
            window.dashboardInstance.config.fieldMeta('linkPreviewHoverDelayMs')?.def);
        expect(meta).toBe(250);
        const unset = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const kept = d.settings.linkPreviewHoverDelayMs;
            delete d.settings.linkPreviewHoverDelayMs;
            const used = d.preview.previewHoverDelay();
            d.settings.linkPreviewHoverDelayMs = kept;
            return used;
        });
        expect(unset).toBe(250);
    });

    test('the checklist writes the card’s rows, and the sample follows', async ({ page }) => {
        await openDisplayTab(page);
        const boxes = page.locator('[data-behavior-field="linkPreviewParts"]');
        // Counted from the card's own list rather than written out here: the
        // point of this test is that every part is offered and starts ticked,
        // and a literal turns each new part into a failure of this assertion
        // instead of a check of the behaviour.
        const partCount = await page.evaluate(() => window.DashboardPreview?.PARTS?.length
            || window.dashboardInstance?.preview?.constructor?.PARTS?.length || 0);
        expect(partCount).toBeGreaterThan(0);
        await expect(boxes).toHaveCount(partCount);
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
