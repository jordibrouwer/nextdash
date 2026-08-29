// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

// Verifies the config view's Statistics → Inbox tab: snapshot counts from
// /api/inbox and lifetime counters from /api/inbox-stats.
test.describe('config stats inbox block', () => {
    test('renders inbox snapshot and lifetime throughput', async ({ page }) => {
        const stamp = Date.now();

        // Seed two inbox items via the API (also increments the durable "added" counters).
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
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

        // Open the config view and switch to Statistics → Inbox.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
        await page.locator('[data-stats-tab="inbox"]').click();

        const inbox = page.locator('#config-stats-inbox');
        await expect(inbox.locator('.config-tile').first()).toBeVisible({ timeout: 15_000 });

        // Reads a tile's numeric value by its label, so the assertions do not
        // depend on tile ordering.
        const tileValue = async (labelRe) => {
            const tile = inbox.locator('.config-tile').filter({
                has: page.locator('.config-tile-label', { hasText: labelRe }),
            }).first();
            return Number((await tile.locator('.config-tile-value').textContent() || '').trim());
        };

        // Snapshot totals reflect the two seeded items (the inbox may already
        // contain others, so assert "at least").
        await expect.poll(() => tileValue(/inbox items|postvak|eingang|boîte/i), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(2);

        // Lifetime "added" counter incremented from the seeds.
        await expect.poll(() => tileValue(/^(added|toegevoegd|hinzugefügt|ajouté)/i), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(2);

        // The per-source table lists the seeded sources.
        await expect(inbox.locator('.config-stats-table')).toContainText(/paste|plakken|collage|einfügen/i);

        // The conversion ratio bar was drawn.
        await expect(inbox.locator('.config-bar-fill')).toHaveCount(1);

        // Drain the seeded items again: a non-empty inbox is itself an
        // "attention" row on the overview, so leaving them behind would fail
        // other specs. Lifetime counters are durable and stay counted.
        await page.evaluate(async (s) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox');
            const body = res.ok ? await res.json() : null;
            const items = Array.isArray(body) ? body : (body?.items || []);
            for (const it of items) {
                if (!String(it?.url || '').includes(String(s))) continue;
                await api(`/api/inbox?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' });
            }
        }, stamp);
    });

    test('the conversion rate counts what left, not what was read', async ({ page }) => {
        // Kept is recorded on every mark-read, and a read link is still sitting
        // in the inbox waiting to be decided on. Counting it as triage put links
        // that had gone nowhere into the denominator, and double-counted every
        // link read before it was promoted.
        await page.route('**/api/inbox-stats', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                version: 1,
                totalAdded: 40, totalPromoted: 10, totalDeleted: 5, totalKept: 35,
                retentionCount: 0, sumRetentionMs: 0,
            }),
        }));

        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
        await page.locator('[data-stats-tab="inbox"]').click();

        const inbox = page.locator('#config-stats-inbox');
        await expect(inbox.locator('.config-tile').first()).toBeVisible({ timeout: 15_000 });

        // 10 of 15, not 10 of 50: the 35 kept never left the inbox.
        await expect(inbox.locator('.config-ratio')).toContainText('67%');
        await expect(inbox.locator('.config-ratio')).not.toContainText('20%');
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
