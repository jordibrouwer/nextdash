// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Monitoring a service that wants a key.
 *
 * A self-hosted service bookmarked at its web interface answers 401 to an
 * anonymous check, so the row reads "broken" while the service is fine, and the
 * only way out was to stop monitoring it — exactly the bookmark worth watching.
 *
 * Three fields fix that: a different address to check, a stored credential to
 * send, and accepting a certificate the machine does not trust. The secrets live
 * in their own file outside the backup, so the panel only ever names them.
 */

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const health = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.health.load?.();
        return !!(d.health.instance || d.health);
    });
    expect(health).toBe(true);
}

test.describe('health checks that can sign in', () => {
    test('a stored credential is offered by name and never by value', async ({ page }) => {
        await openHealth(page);

        const listed = await page.evaluate(async () => {
            // nextDashFetch carries the write token; a bare fetch is refused,
            // which is the protection working rather than a bug.
            const send = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
            const put = await send('/api/health/credentials', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'sonarr:test',
                    label: 'Sonarr (test)',
                    headers: { 'X-Api-Key': 'the-secret-value' },
                }),
            });
            const saved = await put.json();
            const res = await fetch('/api/health/credentials');
            const listing = await res.json();
            return { saved, listing, raw: JSON.stringify(listing) };
        });

        expect(listed.listing.credentials['sonarr:test']).toBe('Sonarr (test)');
        // The whole point: the value must not come back from any route.
        expect(listed.raw).not.toContain('the-secret-value');

        const inPanel = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const health = d.health.instance || d.health;
            health.dash.healthCredentials = { 'sonarr:test': 'Sonarr (test)' };
            return health.renderCredentialOptions('sonarr:test');
        });
        expect(inPanel).toContain('Sonarr (test)');
        expect(inPanel).toContain('selected');
        expect(inPanel).not.toContain('the-secret-value');

        await page.evaluate(() => (window.nextDashFetch || fetch)(
            '/api/health/credentials?id=sonarr:test', { method: 'DELETE' }));
    });

    /*
     * The reachability fields show on every row, not only monitored ones.
     *
     * "Retest all" and a manual re-check run on unmonitored bookmarks too, and
     * a service behind a key answers 401 to those just the same — so gating
     * these on monitoring would leave the fix out of reach for the bookmark
     * that needs it.
     */
    test('reaching the service can be set whether or not monitoring is on', async ({ page }) => {
        await openHealth(page);

        const panels = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const health = d.health.instance || d.health;
            health.dash.healthCredentials = {};
            const issue = { pageId: 1, index: 0, url: 'https://example.com/', checkUrl: '', credentialId: '' };
            const monitored = health.renderExpectPanel({ ...issue, monitor: true, checkMode: 'monitor' });
            const plain = health.renderExpectPanel({ ...issue, monitor: false });
            return { monitored, plain };
        });

        for (const [name, html] of Object.entries(panels)) {
            expect(html, `${name}: check address`).toContain('data-check-url');
            expect(html, `${name}: credential`).toContain('data-credential-id');
            expect(html, `${name}: certificate`).toContain('data-allow-insecure');
            expect(html, `${name}: save`).toContain('data-expect-save');
        }
        // What a good answer looks like stays behind the monitoring gate.
        expect(panels.monitored).toContain('data-expect-status');
        expect(panels.plain).not.toContain('data-expect-status');
    });

    // An address that is not http(s) is refused rather than stored: a field
    // that silently keeps an unusable value reads as configured when it is not.
    test('an unusable check address is not stored', async ({ page }) => {
        await openHealth(page);
        const saved = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const bookmark = (d.bookmarks || [])[0];
            if (!bookmark) return null;
            const send = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
            const res = await send('/api/health/expectations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: Number(d.currentPageId ?? d.pages?.[0]?.id ?? 1),
                    index: 0,
                    url: bookmark.url,
                    expectText: '', expectTextAbsent: false, expectStatus: '',
                    watchDrift: false, notifyMuted: false,
                    checkUrl: 'file:///etc/passwd',
                    credentialId: '', allowInsecureTls: false,
                }),
            });
            if (!res.ok) return { refused: true, status: res.status };
            return await res.json();
        });
        test.skip(saved === null, 'no bookmark on the first page to test with');
        if (!saved.refused) {
            expect(saved.checkUrl || '').toBe('');
        }
    });

    // A credential id naming nothing is dropped, so the panel never offers a
    // choice that quietly does not exist.
    test('a credential id that names nothing is not stored', async ({ page }) => {
        await openHealth(page);
        const saved = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const bookmark = (d.bookmarks || [])[0];
            if (!bookmark) return null;
            const send = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
            const res = await send('/api/health/expectations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: Number(d.currentPageId ?? d.pages?.[0]?.id ?? 1),
                    index: 0,
                    url: bookmark.url,
                    expectText: '', expectTextAbsent: false, expectStatus: '',
                    watchDrift: false, notifyMuted: false,
                    checkUrl: '', credentialId: 'never-created', allowInsecureTls: false,
                }),
            });
            if (!res.ok) return { refused: true };
            return await res.json();
        });
        test.skip(saved === null, 'no bookmark on the first page to test with');
        if (!saved.refused) {
            expect(saved.credentialId || '').toBe('');
        }
    });
});
