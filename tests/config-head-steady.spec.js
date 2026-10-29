// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Moving down the section rail must not move the rail: the band over the
 * sections is one height on every tab. It used to grow a line where the title
 * broke between the material's mark and the word, or the description wrapped.
 */
const SECTIONS = ['overview', 'appearance', 'bookmarks', 'structure', 'behavior', 'inbox', 'data',
    'widgets', 'containers', 'unraid', 'glances', 'monitoring', 'status-page', 'assistant', 'statistics', 'help', 'logs'];

for (const width of [1180, 1400]) {
    test(`the band and the rail stay put across every section at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        const seen = await page.evaluate(async (sections) => {
            document.body.dataset.materialStyle = 'signature';
            document.body.dataset.material = 'brushed';
            const rows = [];
            for (const s of sections) {
                await window.dashboardInstance.config.openConfigView(s);
                await new Promise((r) => setTimeout(r, 350));
                const head = document.querySelector('.config-view-head')?.getBoundingClientRect();
                const find = document.querySelector('[data-config-action="settings-jump"]')?.getBoundingClientRect();
                if (head && find) rows.push({ s, head: Math.round(head.height), rail: Math.round(find.top) });
            }
            return rows;
        }, SECTIONS);
        expect(seen.length).toBeGreaterThan(10);
        const first = seen[0];
        for (const row of seen) {
            expect(row, `${row.s} moved the band or the rail`).toEqual({ ...first, s: row.s });
        }
    });
}
