// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A round of checks is one write, not one per row.
 *
 * Opening the dashboard fired a POST per bookmark that pinged — measured at ten
 * of them over seven seconds on a page of 115 rows, each taking the store's
 * global lock and rewriting the whole page file before the reader had touched
 * anything. They arrive together now.
 *
 * The payload changed with it: the old route carried the bookmark's `index` in
 * the client's copy of the page, and a delete or a move between the ping going
 * out and the write landing pointed that number at a different bookmark. It
 * carries the URL now, which is what the row actually is.
 */
test('a page load writes check results together, keyed on the url', async ({ page }) => {
    const single = [];
    const batches = [];
    page.on('request', (r) => {
        const url = r.url();
        if (url.includes('/api/health/update-status')) single.push(url);
        if (url.includes('/api/health/statuses')) {
            try { batches.push(JSON.parse(r.postData() || '{}')); } catch { batches.push(null); }
        }
    });

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Give a check round time to finish and flush.
    await expect
        .poll(() => batches.length, { timeout: 20_000 })
        .toBeGreaterThan(0);

    // Nothing takes the per-row route any more.
    expect(single, 'a single-row status write was still sent').toEqual([]);

    const first = batches.find(Boolean);
    expect(first).toBeTruthy();
    expect(first.pageId, 'the batch has to name the page it writes').toBeGreaterThan(0);
    expect(Array.isArray(first.results)).toBe(true);
    expect(first.results.length).toBeGreaterThan(0);

    for (const result of first.results) {
        // A url, not an index: this is the whole point of the change.
        expect(result.url, 'a result without a url cannot be matched safely').toBeTruthy();
        expect(result).not.toHaveProperty('index');
        expect(['online', 'offline']).toContain(result.status);
    }
});

test('the same url is written once per round, with its latest answer', async ({ page }) => {
    const batches = [];
    page.on('request', (r) => {
        if (r.url().includes('/api/health/statuses')) {
            try { batches.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ }
        }
    });

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect.poll(() => batches.length, { timeout: 20_000 }).toBeGreaterThan(0);

    for (const batch of batches) {
        const urls = (batch.results || []).map((r) => r.url);
        expect(new Set(urls).size, 'a url appears twice in one batch').toBe(urls.length);
    }
});

/**
 * The grouping itself, driven directly.
 *
 * The seeded page has one checked bookmark, so a real round can only ever
 * produce a batch of one and proves nothing about grouping — the assertion has
 * to hand the monitor several results while a round is open. `isChecking` is
 * what tells persistBookmarkStatus to collect rather than send, which is the
 * behaviour under test.
 */
test('results collected during a round leave as a single request', async ({ page }) => {
    const batches = [];
    page.on('request', (r) => {
        if (r.url().includes('/api/health/statuses')) {
            try { batches.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ }
        }
    });

    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    const sent = await page.evaluate(async () => {
        const sm = window.dashboardInstance.statusMonitor;
        const bms = window.dashboardInstance.bookmarks.slice(0, 3);
        sm.isChecking = true;                       // a round is running
        for (const b of bms) {
            await sm.persistBookmarkStatus(b, 'offline', 'Timed out');
        }
        const pendingDuringRound = sm._pendingStatuses.size;
        sm.isChecking = false;
        await sm.flushPendingStatuses();
        return { pendingDuringRound, count: bms.length };
    });

    expect(sent.pendingDuringRound, 'results were not held while the round was open')
        .toBe(sent.count);

    await expect.poll(() => batches.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const grouped = batches.find((b) => (b.results || []).length === sent.count);
    expect(grouped, `${sent.count} results did not arrive as one request`).toBeTruthy();
});
