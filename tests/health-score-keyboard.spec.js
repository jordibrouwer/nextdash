// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * The score breakdown and its keyboard path. nextDash is keyboard-first, so every
 * one of these must work without touching the mouse.
 */

function reportWithPenalties() {
    return {
        score: 40,
        summary: { brokenCount: 1, healthyCount: 0, totalBookmarks: 2 },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'Page 1', name: 'Broken one',
                url: 'https://example.com/broken', category: 'test',
                status: 'broken', score: 25,
                reasons: ['HTTP 500', 'Never opened', 'No preview metadata yet'],
                reasonDetails: [
                    { code: 'last_error', detail: 'HTTP 500', penalty: 60 },
                    { code: 'never_opened', penalty: 10 },
                    { code: 'no_preview', penalty: 5 }
                ]
            },
            {
                pageId: 1, index: 1, pageName: 'Page 1', name: 'Second row',
                url: 'https://example.com/second', category: 'test',
                status: 'unused', score: 85,
                reasons: ['Never opened'],
                reasonDetails: [{ code: 'never_opened', penalty: 10 }]
            }
        ],
        duplicateGroups: []
    };
}

async function gotoHealth(page) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(reportWithPenalties())
        });
    });
    await page.goto('/health?filter=all');
    await page.waitForSelector('#health-issues .health-row', { timeout: 15_000 });
}

test.describe('health score breakdown', () => {
    test('score badge expands to a breakdown that sums to the score', async ({ page }) => {
        await gotoHealth(page);

        const panel = page.locator('[data-score-panel]').first();
        await expect(panel).toBeHidden();

        await page.locator('[data-score-toggle]').first().click();
        await expect(panel).toBeVisible();

        // The listed deductions must reconcile with the score shown.
        const costs = await panel.locator('.health-score-item-cost').allTextContents();
        const deducted = costs.reduce((sum, text) => sum + Number(text.replace(/[^0-9]/g, '')), 0);
        expect(deducted).toBe(75);
        await expect(panel.locator('.health-score-total-value')).toHaveText('25');
        expect(100 - deducted).toBe(25);
    });

    // Row controls sit outside the tab sequence by design (roving tabindex, see
    // syncRowTabStops) — otherwise each row would cost ~8 tab stops. They must still
    // be operable: focusable programmatically, and driven by the row shortcuts.
    test('score badge is operable once focused, though it is not a tab stop', async ({ page }) => {
        await gotoHealth(page);

        const toggle = page.locator('[data-score-toggle]').first();
        await expect(toggle).toHaveAttribute('tabindex', '-1');

        // tabindex="-1" must not block programmatic focus or activation.
        await toggle.focus();
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-score-panel]').first()).toBeVisible();

        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('s toggles the score panel for the focused row', async ({ page }) => {
        await gotoHealth(page);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await expect(page.locator('.health-row--focused')).toHaveCount(1);

        await page.keyboard.press('s');
        await expect(page.locator('.health-row--focused [data-score-panel]')).toBeVisible();

        await page.keyboard.press('s');
        await expect(page.locator('.health-row--focused [data-score-panel]')).toBeHidden();
    });

    test('x selects the focused row without losing focus', async ({ page }) => {
        await gotoHealth(page);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        await page.keyboard.press('x');

        await expect(page.locator('.health-row--selected')).toHaveCount(1);
        await expect(page.locator('#health-selection-toolbar')).toBeVisible();
        // Focus must survive selection, or j/k restarts from the top.
        await expect(page.locator('.health-row--focused')).toHaveCount(1);
        await expect(page.locator('.health-row--selected.health-row--focused')).toHaveCount(1);
    });

    test('g and G jump to first and last row', async ({ page }) => {
        await gotoHealth(page);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('G');
        await expect(page.locator('.health-row').last()).toHaveClass(/health-row--focused/);

        await page.keyboard.press('g');
        await expect(page.locator('.health-row').first()).toHaveClass(/health-row--focused/);
    });

    test('Escape closes score panels', async ({ page }) => {
        await gotoHealth(page);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('s');
        await expect(page.locator('[data-score-panel]:not([hidden])')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-score-panel]:not([hidden])')).toHaveCount(0);
    });

    test('shortcut keys stay out of the search field', async ({ page }) => {
        await gotoHealth(page);

        const search = page.locator('#health-search');
        await search.click();
        await search.type('sxpg');

        await expect(search).toHaveValue('sxpg');
        await expect(page.locator('[data-score-panel]:not([hidden])')).toHaveCount(0);
        await expect(page.locator('.health-row--selected')).toHaveCount(0);
    });

    test('an open panel survives a re-render', async ({ page }) => {
        await gotoHealth(page);

        await page.locator('[data-score-toggle]').first().click();
        await expect(page.locator('[data-score-panel]').first()).toBeVisible();

        // Re-render via a filter change; the panel must not silently collapse.
        await page.evaluate(() => {
            document.getElementById('health-sort-select')?.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect(page.locator('[data-score-panel]').first()).toBeVisible();
    });
});
