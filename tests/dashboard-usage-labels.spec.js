// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Give the first rendered bookmark a known history and repaint. */
async function seedFirstRow(page, stats) {
    const url = await page.evaluate(async (s) => {
        const d = window.dashboardInstance;
        const found = document.querySelector('#dashboard-layout .bookmark-link[data-bookmark-url]')
            ?.getAttribute('data-bookmark-url');
        const bm = d.allBookmarks.find((b) => b.url === found);
        // A shortcut is what puts the counts at risk of being announced, so
        // ensure one exists rather than depending on which row sorts first.
        Object.assign(bm, s, { shortcut: bm.shortcut || 'ZZ' });
        // incremental:false — the incremental path reuses cached rows and would
        // not pick the seeded counts up.
        await d.renderDashboard({ incremental: false });
        return found;
    }, stats);
    await page.waitForSelector(`.bookmark-link[data-bookmark-url="${url}"]`);
    return url;
}

test.describe('usage in the row tooltip', () => {
    test('the title carries the open count and last opened', async ({ page }) => {
        await loadDashboard(page);
        const url = await seedFirstRow(page, { openCount: 35, lastOpened: Date.now() - 26 * 60 * 60 * 1000 });
        const text = page.locator(`.bookmark-link[data-bookmark-url="${url}"] .bookmark-text`).first();
        const title = await text.getAttribute('title');
        expect(title).toContain('35');
        expect(title).toMatch(/yesterday/i);
        // The placeholder must be substituted, not printed.
        expect(title).not.toContain('{count}');
        expect(title).not.toContain('{last}');
    });

    test('a never-opened bookmark keeps the plain label', async ({ page }) => {
        await loadDashboard(page);
        // Asserted through the builder rather than a rendered row: the status
        // monitor writes live counts back over a seeded zero mid-test.
        const title = await page.evaluate(() => {
            const d = window.dashboardInstance;
            return d.bookmarkRows.bookmarkRowTitle({ name: 'Fresh link', url: 'https://example.com', openCount: 0, lastOpened: 0 });
        });
        expect(title).toBe('Fresh link');
        expect(title).not.toContain('\n');
    });

    test('the aria-label stays lean so screen readers are not flooded', async ({ page }) => {
        await loadDashboard(page);
        const url = await seedFirstRow(page, { openCount: 35, lastOpened: Date.now() - 26 * 60 * 60 * 1000 });
        const row = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first();
        // The row is a div; the link a screen reader lands on is the anchor inside it.
        const aria = await row.locator('a.bookmark-open').getAttribute('aria-label');
        // Announced on every row while arrowing through the grid: the counts
        // belong in the tooltip, which a screen reader user is not forced to hear.
        expect(aria).toBeTruthy();
        expect(aria).not.toMatch(/opened \d+ times/i);
        expect(aria).not.toContain('35');
        // The tooltip on the same row does carry them, so this is a split and
        // not simply a feature that failed to render.
        const title = await row.locator('.bookmark-text').getAttribute('title');
        expect(title).toContain('35');
    });
});

test.describe('preview card usage line', () => {
    /** The card is built from the bookmark, so this asserts the formatter's output. */
    async function usageTextFor(page, stats) {
        return page.evaluate((s) => {
            const d = window.dashboardInstance;
            return d.preview.formatPreviewUsageText(s.openCount, s.lastOpened);
        }, stats);
    }

    test('counts calendar days, not elapsed hours', async ({ page }) => {
        await loadDashboard(page);
        // 23:00 "last night": fewer than 24 elapsed hours, but a day boundary
        // has been crossed. The old elapsed-hours maths called this "today".
        const lateLastNight = await page.evaluate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            d.setHours(23, 0, 0, 0);
            return d.getTime();
        });
        const skip = await page.evaluate(() => new Date().getHours() >= 23);
        test.skip(skip, 'after 23:00 the seeded moment is the same calendar day');

        const text = await usageTextFor(page, { openCount: 4, lastOpened: lateLastNight });
        expect(text).toMatch(/yesterday/i);
        expect(text).not.toMatch(/today/i);
    });

    test('renders the count and substitutes every placeholder', async ({ page }) => {
        await loadDashboard(page);
        const text = await usageTextFor(page, { openCount: 12, lastOpened: Date.now() - 3 * 60 * 60 * 1000 });
        expect(text).toContain('12');
        expect(text).toMatch(/3h ago/);
        expect(text).not.toContain('{');
    });

    test('falls back to the count alone when never opened', async ({ page }) => {
        await loadDashboard(page);
        const text = await usageTextFor(page, { openCount: 3, lastOpened: 0 });
        expect(text).toMatch(/3/);
        expect(text).not.toContain('{');
        expect(text).not.toMatch(/last/i);
    });
});
