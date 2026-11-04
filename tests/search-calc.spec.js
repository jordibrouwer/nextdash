// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The search panel answers sums, percentages and unit conversions as its first
 * row. The parser is its own (no eval), so what it refuses matters as much as
 * what it answers.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.SearchCalc, null, { timeout: 20_000 });
}

test.describe('the calculator', () => {
    test('answers arithmetic, percentages and units', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            const r = (q) => window.SearchCalc.evaluate(q)?.result ?? null;
            return {
                sum: r('2+2*3'), brackets: r('(1+2)^3'), percent: r('15% of 240'),
                km: r('5 km in mi'), temp: r('100 f to c'), data: r('2 gib in mib'),
                spaced: r('12 - 5'), negPower: r('-2^2'), negExp: r('2^-1'),
            };
        });
        expect(out.sum).toBe('8');
        expect(out.brackets).toBe('27');
        expect(out.percent).toBe('36');
        expect(out.km).toMatch(/^3\.10685/);
        expect(out.temp).toMatch(/^37\.77.* °C$/);
        expect(out.data).toMatch(/^2,?048 mib$/);
        expect(out.spaced).toBe('7');
        expect(out.negPower).toBe('-4');
        expect(out.negExp).toBe('0.5');
    });

    test('reads a decimal comma as a decimal, and a comma before three digits as thousands', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => ['1,5 + 1', '15% van 2,5', '2,5 km in m', '1,000 + 1', '1,234,567 + 1', '1,2,3 + 1']
            .map((q) => window.SearchCalc.evaluate(q)?.copy ?? null));
        expect(out).toEqual(['2.5', '0.375', '2500', '1001', '1234568', null]);
    });

    test('leaves words, dates, lone numbers and nonsense alone', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => ['github', '2026-11-03', '42', '3-', '1/0', '5 + ', 'alert(1)', '=1+1', '=7', '5 apples in pears', '1.2.3+1',
            '24/7', '06-12345678', '03-11-2026', '20-30', '1-2', '9^9^9', '('.repeat(500) + '1', '1+' + '-'.repeat(5000) + '1']
            .map((q) => window.SearchCalc.evaluate(q)));
        expect(out).toEqual(out.map(() => null));
    });

    test('is the first row in the panel, and Enter copies the answer', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            window.__copied = null;
            const real = navigator.clipboard;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; }, real } });
        });
        await page.keyboard.press('>');
        await page.keyboard.type('12*12');
        const first = page.locator('#search-matches .search-match').first();
        await expect(first).toContainText('144');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__copied), { timeout: 5000 }).toBe('144');
    });

    test('the assistant prefix keeps its own meaning: =2+2 is a question, not a sum', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.keyboard.type('=2+2');
        const hasCalc = await page.evaluate(() => (window.dashboardInstance.searchComponent.searchMatches || []).some((m) => m.calc));
        expect(hasCalc).toBe(false);
    });

    test('a phone number or a date is not answered as a sum, and Enter still opens the bookmark list', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.keyboard.type('06-12345678');
        const hasCalc = await page.evaluate(() => (window.dashboardInstance.searchComponent.searchMatches || []).some((m) => m.calc));
        expect(hasCalc).toBe(false);
    });

    test('a command query is not turned into a sum', async ({ page }) => {
        await openDashboard(page);
        await page.keyboard.press('>');
        await page.keyboard.type(':1+1');
        const hasCalc = await page.evaluate(() => (window.dashboardInstance.searchComponent.searchMatches || []).some((m) => m.calc));
        expect(hasCalc).toBe(false);
    });
});
