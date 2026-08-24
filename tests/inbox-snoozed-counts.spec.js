const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Every visible inbox number counts the same thing: the items the feed would
 * actually show. A snoozed link is hidden from the list, so it must not be
 * counted by the tiles, the header badge or the site filter that lead back to it.
 *
 * Snoozing happens through the row's own Snooze button rather than by writing
 * snoozedUntil directly — a count that only holds for hand-set state proves
 * nothing about the path a user takes.
 */
test.describe('inbox counts exclude snoozed items', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

        // These tests assert on exact counts and each one snoozes a row, so
        // leftovers from an earlier test would both skew the totals and leave the
        // default filter with no rows to act on. Start from an empty inbox.
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox');
            const body = await res.json().catch(() => null);
            const items = Array.isArray(body) ? body : (body?.items || []);
            await Promise.all(items.map((item) =>
                api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
            ));
        });
    });

    /** Seed `n` items onto the cleaned inbox and open the view on them. */
    async function seedAndOpen(page, title, n = 1) {
        const stamp = Date.now();
        await page.evaluate(async ({ stamp, title, n }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            for (let i = 0; i < n; i += 1) {
                await api('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: `https://snooze-count-${stamp}-${i}.example.com`,
                        title: `${title} ${i + 1}`,
                    }),
                });
            }
        }, { stamp, title, n });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        // The view can render from a cached list captured before the seeds landed,
        // so re-fetch once and wait for all of them rather than for "any row".
        await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender?.({ refresh: true }));
        await expect(page.locator('.inbox-item')).toHaveCount(n);
    }

    const tileValue = (page, key) =>
        page.locator(`button.inbox-tile[data-inbox-tile="${key}"] .inbox-tile-value`);
    const weekValue = (page) =>
        page.locator('.inbox-tiles > .inbox-tile:not([data-inbox-tile]) .inbox-tile-value');

    /**
     * Snooze the first row the way a user does: the action strip is collapsed to
     * zero height until the card is hovered, so the button has to be revealed
     * before it can be clicked.
     */
    async function snoozeFirstRow(page) {
        const rowsBefore = await page.locator('.inbox-item').count();
        const card = page.locator('.inbox-item').first();
        await card.hover();
        const btn = card.locator('[data-inbox-action="snooze"]');
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(page.locator('.inbox-snooze-menu')).toBeVisible();
        await page.locator('.inbox-snooze-option').first().click();
        await expect(page.locator('.inbox-snooze-menu')).toHaveCount(0);
        // The snooze is a PATCH followed by a re-render: the menu closing only
        // means the click was taken, not that the row has gone. Assertions on the
        // counts would otherwise race the request and read the pre-snooze numbers.
        await expect(page.locator('.inbox-item')).toHaveCount(rowsBefore - 1);
    }

    test('snoozing a row drops it from Total, Unread and This week', async ({ page }) => {
        // Two items on a cleaned inbox, so every count below is an exact number
        // rather than a delta that would also hold if the tiles counted nothing.
        await seedAndOpen(page, 'Snooze count seed', 2);

        await expect(tileValue(page, 'all')).toHaveText('2');
        await expect(tileValue(page, 'unread')).toHaveText('2');
        await expect(tileValue(page, 'snoozed')).toHaveText('0');
        await expect(weekValue(page)).toHaveText('2');

        await snoozeFirstRow(page);

        // The three awake counts each drop to 1; Snoozed accounts for the other.
        // "This week" is the regression: it counted by addedAt alone, so a freshly
        // snoozed item stayed in it while the tiles beside it let it go.
        await expect(tileValue(page, 'all')).toHaveText('1');
        await expect(tileValue(page, 'unread')).toHaveText('1');
        await expect(tileValue(page, 'snoozed')).toHaveText('1');
        await expect(weekValue(page)).toHaveText('1');
    });

    test('the Total tile count matches the rows its filter shows', async ({ page }) => {
        await seedAndOpen(page, 'Total parity seed', 3);

        // Snooze one row so the raw item count and the "all" count diverge: this
        // is the case where the tile used to read 3 and open a list of 2.
        await snoozeFirstRow(page);

        await page.locator('button.inbox-tile[data-inbox-tile="all"]').click();
        await expect(page.locator('button.inbox-tile[data-inbox-tile="all"]')).toHaveClass(/is-active/);

        await expect(tileValue(page, 'all')).toHaveText('2');
        await expect(page.locator('.inbox-item')).toHaveCount(2);
    });

    test('the header badge ignores snoozed items', async ({ page }) => {
        await seedAndOpen(page, 'Badge parity seed', 2);
        await expect(page.locator('.inbox-count-badge')).toHaveText('2');

        await snoozeFirstRow(page);

        await expect(page.locator('.inbox-count-badge')).toHaveText('1');
    });

    test('a site filter survives a reload, and is dropped once its site is gone', async ({ page }) => {
        // Two sites, so selecting one is a real narrowing rather than a no-op.
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            for (const host of ['alpha-site.example.com', 'beta-site.example.com']) {
                await api('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `https://${host}/one`, title: `Seed ${host}` }),
                });
            }
        });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender?.({ refresh: true }));
        await expect(page.locator('.inbox-item')).toHaveCount(2);

        await page.locator('.inbox-domain-select').selectOption('alpha-site.example.com');
        await expect(page.locator('.inbox-item')).toHaveCount(1);

        // Persistence: the choice is a visible control, so it comes back the way
        // filter and sort do rather than resetting on every visit. Navigate to a
        // bare URL rather than reloading — the view mirrors its state into the
        // query string, and a reload would restore it from there without storage
        // ever being consulted.
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect(page.locator('.inbox-domain-select')).toHaveValue('alpha-site.example.com');
        await expect(page.locator('.inbox-item')).toHaveCount(1);

        // Now remove the last item from that site. The <option> goes with it, and
        // a filter still pointing at the vanished host would leave the select
        // reading "All sites" over an empty feed with nothing explaining why.
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox');
            const body = await res.json().catch(() => null);
            const items = Array.isArray(body) ? body : (body?.items || []);
            const target = items.find((item) => String(item.url || '').includes('alpha-site.example.com'));
            if (target) {
                await api(`/api/inbox?id=${encodeURIComponent(target.id)}`, { method: 'DELETE' });
            }
        });
        await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender?.({ refresh: true }));

        // The surviving item from the other site is visible, not filtered away.
        await expect(page.locator('.inbox-item')).toHaveCount(1);
        await expect(page.locator('.inbox-domain-select')).toHaveValue('');
    });
});
