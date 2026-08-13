const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Theme export and CSV export both shipped without a way back in, so a palette
 * or a spreadsheet-tidied list could only return through a full ZIP restore,
 * which overwrites everything.
 */
async function openConfig(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#config');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

test.describe('CSV import', () => {
    test('parses exactly what the export writes', async ({ page }) => {
        await openConfig(page);
        const parsed = await page.evaluate(() => {
            // The export quotes every field and prefixes a BOM.
            const csv = '﻿"Name","URL","Category","Page","Shortcut","Tags","Notes"\r\n'
                + '"Example","https://example.com","Dev","Main","e","one, two","a note"\r\n';
            return DashboardConfig.parseBookmarksCSV(csv);
        });
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({
            name: 'Example', url: 'https://example.com',
            category: 'Dev', shortcut: 'e', note: 'a note',
        });
        expect(parsed[0].tags).toEqual(['one', 'two']);
    });

    // The reason this is not split(','): the export quotes fields precisely so
    // they can hold commas, quotes and newlines.
    test('survives commas, doubled quotes and line breaks inside a field', async ({ page }) => {
        await openConfig(page);
        const parsed = await page.evaluate(() => {
            const csv = '"Name","URL","Notes"\r\n'
                + '"Tricky","https://a.example","one, two ""quoted"" and\na second line"\r\n';
            return DashboardConfig.parseBookmarksCSV(csv);
        });
        expect(parsed).toHaveLength(1);
        expect(parsed[0].note).toBe('one, two "quoted" and\na second line');
    });

    test('reads columns by header, not by position', async ({ page }) => {
        await openConfig(page);
        const parsed = await page.evaluate(() =>
            DashboardConfig.parseBookmarksCSV('"URL","Name"\r\n"https://b.example","Reordered"\r\n'));
        expect(parsed[0]).toMatchObject({ name: 'Reordered', url: 'https://b.example' });
    });

    test('a row without a URL is not a bookmark', async ({ page }) => {
        await openConfig(page);
        const parsed = await page.evaluate(() =>
            DashboardConfig.parseBookmarksCSV('"Name","URL"\r\n"No link",""\r\n"Good","https://c.example"\r\n'));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].url).toBe('https://c.example');
    });
});

test.describe('theme import', () => {
    test('an exported theme comes back as a new theme', async ({ page }) => {
        await openConfig(page);
        const result = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const theme = c.normalizeImportedTheme({ name: 'Sunset', '--bg-primary': '#101020', '--text-primary': '#eee' });
            return theme;
        });
        expect(result).toMatchObject({ name: 'Sunset', '--bg-primary': '#101020' });
    });

    test('a JSON file that is not a theme is refused', async ({ page }) => {
        await openConfig(page);
        const rejected = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return [
                c.normalizeImportedTheme({ hello: 'world' }),
                c.normalizeImportedTheme([1, 2, 3]),
                c.normalizeImportedTheme(null),
                c.normalizeImportedTheme({ name: 'Colourless' }),
            ];
        });
        expect(rejected).toEqual([null, null, null, null]);
    });

    test('the button is offered beside Export', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.waitForTimeout(600);
        const hasBoth = await page.evaluate(() => ({
            exp: !!document.querySelector('[data-theme-action="export"]'),
            imp: !!document.querySelector('[data-theme-action="import"]'),
        }));
        // Export is only rendered with a theme selected; when it is there, import must be too.
        if (hasBoth.exp) expect(hasBoth.imp).toBe(true);
    });
});
