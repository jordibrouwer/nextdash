// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * nextDashFetchShared: one request for the same GET asked twice at once, but
 * never an answer that started before a write of ours.
 */
test('callers at the same moment share a request; a write in between splits them', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => typeof window.nextDashFetchShared === 'function');

    let hits = 0;
    await page.route('**/api/shared-probe', async (route) => {
        if (route.request().method() === 'GET') {
            hits += 1;
            const n = hits;
            await new Promise((r) => setTimeout(r, 200));
            return route.fulfill({ json: { n } });
        }
        return route.fulfill({ json: { ok: true } });
    });

    const together = await page.evaluate(async () => {
        const [a, b] = await Promise.all([
            window.nextDashFetchShared('/api/shared-probe', { cache: 'no-store' }).then((r) => r.json()),
            window.nextDashFetchShared('/api/shared-probe', { cache: 'no-store' }).then((r) => r.json()),
        ]);
        return [a.n, b.n];
    });
    expect(together[0]).toBe(together[1]);
    expect(hits).toBe(1);

    hits = 0;
    const split = await page.evaluate(async () => {
        const first = window.nextDashFetchShared('/api/shared-probe', { cache: 'no-store' }).then((r) => r.json());
        await window.nextDashFetch('/api/shared-probe', { method: 'POST', body: '{}' });
        const second = window.nextDashFetchShared('/api/shared-probe', { cache: 'no-store' }).then((r) => r.json());
        const fresh = window.nextDashFetchShared('/api/shared-probe', { cache: 'no-store', fresh: true }).then((r) => r.json());
        return (await Promise.all([first, second, fresh])).map((x) => x.n);
    });
    // Three requests: the one before the write, the one after it, and the fresh one.
    expect(new Set(split).size).toBe(3);
    expect(hits).toBe(3);
});
