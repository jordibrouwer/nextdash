const { test, expect } = require('@playwright/test');

// Verifies the Config → Stats inbox block: snapshot counts from /api/inbox and
// lifetime counters from /api/inbox-stats, rendered with the shared stats visuals.
test.describe('config stats inbox block', () => {
    test('renders inbox snapshot and lifetime throughput', async ({ page }) => {
        const stamp = Date.now();

        // Seed two inbox items via the API (also increments the durable "added" counters).
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await page.evaluate(async (s) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://alpha-${s}.example.com`, title: 'Alpha', source: 'paste' }),
            });
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://beta-${s}.example.com`, title: 'Beta', source: 'extension' }),
            });
        }, stamp);

        // Open Config and activate the Stats tab.
        await page.goto('/config#stats');
        await page.waitForSelector('#stats-inbox', { timeout: 15_000 });
        await page.evaluate(() => {
            window.configManager?.stats?.refresh?.(window.configManager);
        });

        // Snapshot totals reflect the two seeded items (inbox may already contain
        // others, so assert "at least").
        await expect
            .poll(async () => Number(await page.locator('#stats-inbox-total').textContent()), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(2);

        // Lifetime "added" counter incremented from the seeds.
        await expect
            .poll(async () => Number(await page.locator('#stats-inbox-added').textContent()), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(2);

        // Sources table renders rows for paste + extension.
        const sourcesText = await page.locator('#stats-inbox-sources-body').textContent();
        expect(sourcesText).toMatch(/paste|plakken|collage|einfügen/i);

        // The trend sparkline SVG was drawn.
        await expect(page.locator('#stats-inbox-sparkline svg')).toHaveCount(1);
    });

    test('promote is attributed as a conversion in lifetime stats', async ({ page }) => {
        const stamp = Date.now();

        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });

        // Read the current promoted count, then add + delete-with-reason=promote.
        const before = await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox-stats');
            const body = await res.json();
            return Number(body?.totalPromoted || 0);
        });

        await page.evaluate(async (s) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://promote-${s}.example.com`, title: 'Promote me' }),
            });
            const body = await res.json();
            const id = body?.item?.id;
            await api(`/api/inbox?id=${encodeURIComponent(id)}&reason=promote`, { method: 'DELETE' });
        }, stamp);

        const after = await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox-stats');
            const body = await res.json();
            return Number(body?.totalPromoted || 0);
        });

        expect(after).toBe(before + 1);
    });
});
