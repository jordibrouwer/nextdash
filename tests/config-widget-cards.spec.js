// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen,
} = require('./e2e-helpers');

/**
 * Each widget is a card. A card opens inline, one at a time, into the three
 * sections; nothing opens by itself, and the side panel the wide layout used
 * to have is gone.
 */
async function openWidgetsSection(page, { widgets }) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const dash = window.dashboardInstance;
        await f(`/api/pages/${dash.pages[0].id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: list }) });
        await dash.config.openConfigView('widgets');
    }, widgets);
    await expect(page.locator('#config-widgets-body')).toBeVisible();
    // Flat, in page order: the groups are headings between lists, and these
    // tests are about the cards, not the grouping.
    await page.locator('[data-widget-sort]').selectOption('order');
    await expect(page.locator('.config-widget-row').first()).toBeVisible();
}

const THREE = [
    { type: 'notes', title: 'Alpha', config: {} },
    { type: 'health', title: 'Beta', config: {} },
    { type: 'rss', title: '', config: { feedUrls: ['https://example.com/feed.xml'] } },
];

// The n-th card as shown (flat order), not the block index, which also counts categories.
const settingsOf = (page, n) => page.locator('.config-widget-row').nth(n).locator('[data-widget-settings]');

test.describe('widgets as cards', () => {
    test.use({ viewport: { width: 1500, height: 950 } });

    test('the list is a grid of cards', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        const display = await page.locator('.config-widget-list').first().evaluate((el) => getComputedStyle(el).display);
        expect(display).toBe('grid');
        const rows = page.locator('.config-widget-row');
        const a = await rows.nth(0).boundingBox();
        const b = await rows.nth(1).boundingBox();
        expect(a && b).toBeTruthy();
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
    });

    test('nothing opens by itself, even on a wide screen', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        await expect(page.locator('.config-widget-row.is-open')).toHaveCount(0);
        await expect(page.locator('.config-widgets-detailpanel')).toHaveCount(0);
        await expect(page.locator('.config-widget-detail')).toHaveCount(0);
    });

    test('Settings opens the card inline and it spans the row', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        await settingsOf(page, 1).click();
        const open = page.locator('.config-widget-row.is-open');
        await expect(open).toHaveCount(1);
        await expect(open.locator('.config-widget-detail')).toBeVisible();
        const list = await page.locator('.config-widget-list').first().boundingBox();
        const box = await open.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(list.width - 2);
        await expect(settingsOf(page, 1)).toHaveAttribute('aria-expanded', 'true');
    });

    test('opening a second card closes the first', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        await settingsOf(page, 0).click();
        await expect(page.locator('.config-widget-row.is-open')).toHaveCount(1);
        await settingsOf(page, 1).click();
        await expect(page.locator('.config-widget-row.is-open')).toHaveCount(1);
        await expect(settingsOf(page, 0)).toHaveAttribute('aria-expanded', 'false');
        await expect(settingsOf(page, 1)).toHaveAttribute('aria-expanded', 'true');
    });

    test('opening another card with unsaved edits asks first', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        await settingsOf(page, 2).click();
        // The feed addresses live in Connection, which starts folded once they are set.
        await page.locator('details[data-widget-section="connection"] > summary').click();
        const feeds = page.locator('[data-widget-setting="feedUrls"]');
        await expect(feeds).toBeVisible();
        await feeds.fill('https://example.org/other.xml');
        await feeds.blur();

        // Refusing keeps the first card open with its edit.
        await settingsOf(page, 0).click();
        const confirm = page.locator('#config-confirm-modal');
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: /cancel|keep|no/i }).first().click();
        await expect(settingsOf(page, 2)).toHaveAttribute('aria-expanded', 'true');
        await expect(feeds).toHaveValue('https://example.org/other.xml');

        // Accepting opens the other card and drops the edit.
        await settingsOf(page, 0).click();
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: /discard/i }).click();
        await expect(settingsOf(page, 0)).toHaveAttribute('aria-expanded', 'true');
        await expect(settingsOf(page, 2)).toHaveAttribute('aria-expanded', 'false');
        await settingsOf(page, 2).click();
        await page.locator('details[data-widget-section="connection"] > summary').click();
        await expect(page.locator('[data-widget-setting="feedUrls"]')).toHaveValue('https://example.com/feed.xml');
    });

    test('a repaint keeps the open card and its open section', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        await settingsOf(page, 2).click();
        const display = page.locator('details[data-widget-section="display"]');
        await expect(display).toBeVisible();
        await display.locator('summary').click();
        await expect(display).not.toHaveAttribute('open', '');
        await page.locator('#config-widget-search').fill('rss');
        await expect(page.locator('.config-widget-row.is-open')).toHaveCount(1);
        await expect(page.locator('details[data-widget-section="display"]')).not.toHaveAttribute('open', '');
    });

    test('no title shows the kind name as the placeholder', async ({ page }) => {
        await openWidgetsSection(page, { widgets: THREE });
        const placeholder = await page.locator('input[data-widget="title"][value=""]').first().getAttribute('placeholder');
        expect((placeholder || '').length).toBeGreaterThan(0);
    });
});
