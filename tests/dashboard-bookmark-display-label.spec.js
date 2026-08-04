// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('dashboard bookmark display label', () => {
    test('nameless bookmarks strip www from hostname label', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => (
            typeof window.BookmarkUrlUtils?.bookmarkDisplayHostnameFromUrl === 'function'
            && typeof window.dashboardInstance?.bookmarkRows?.bookmarkDisplayLabel === 'function'
        ));

        const labels = await page.evaluate(() => ({
            www: window.BookmarkUrlUtils.bookmarkDisplayHostnameFromUrl('https://www.github.com/foo'),
            bare: window.BookmarkUrlUtils.bookmarkDisplayHostnameFromUrl('https://docs.github.com'),
            row: window.dashboardInstance?.bookmarkRows?.bookmarkDisplayLabel?.({
                name: '',
                url: 'https://www.example.com/path',
            }),
        }));

        expect(labels.www).toBe('github.com');
        expect(labels.bare).toBe('docs.github.com');
        expect(labels.row).toBe('example.com');
    });
});
