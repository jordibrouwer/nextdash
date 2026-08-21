// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Uptime and a certificate about to expire were already on the wire.
 *
 * The dashboard fetches the whole health report on every load to put a number
 * on the health icon, and read twelve counts out of it — a row per bookmark,
 * carrying monitor stats and certificate expiries, dropped on the floor. So the
 * preview card could only show those figures by asking the server again, which
 * a hover is not allowed to do, and they appeared only on a pinned card.
 *
 * The badge keeps what it fetched now, and the card reads it.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** A report shaped like the server's, for one bookmark we control. */
const reportFor = (url) => ({
    summary: { totalBookmarks: 1, brokenCount: 0, monitorDownCount: 0 },
    certificates: { 'blog.example': { host: 'blog.example', expiresAt: Date.now() + 6 * 86400000 } },
    issues: [
        {
            url, name: 'Monitored', monitor: true, certHost: 'blog.example',
            monitorStats: { uptime30d: { ratio: 0.9998, samples: 8640 } },
        },
        // A healthy, unmonitored bookmark has nothing to report; keeping it
        // would be a map the size of the collection saying nothing.
        { url: 'https://quiet.example/', name: 'Quiet', status: 'healthy' },
    ],
});

test.describe('what health already knows, on the dashboard', () => {
    test('the index keeps only the rows with something to say', async ({ page }) => {
        await openDashboard(page);
        const kept = await page.evaluate((report) => {
            window.HealthFacts.remember(report);
            return {
                size: window.HealthFacts.size,
                monitored: window.HealthFacts.get(report.issues[0].url),
                quiet: window.HealthFacts.get('https://quiet.example/'),
            };
        }, reportFor('https://blog.example/posts'));

        expect(kept.size).toBe(1);
        expect(kept.quiet).toBe(null);
        expect(kept.monitored.uptime30d).toBeCloseTo(0.9998, 4);
        expect(kept.monitored.certExpiresAt).toBeGreaterThan(0);
    });

    test('a hover shows uptime and the expiring certificate, with no request', async ({ page }) => {
        await openDashboard(page);

        const drawn = await page.evaluate((report) => {
            const d = window.dashboardInstance;
            const url = report.issues[0].url;
            window.HealthFacts.remember(report);
            // Nothing here may reach the server: count what does.
            let requests = 0;
            const realFetch = window.fetch;
            window.fetch = (...args) => { requests += 1; return realFetch.apply(window, args); };

            const bookmark = { name: 'Monitored', url, openCount: 4, lastOpened: Date.now() };
            const card = d.preview.ensureBookmarkPreviewCard();
            const payload = d.preview.buildPreviewPayload(bookmark, { title: 'Monitored', url });
            d.preview.paintPreviewCard(card, payload, { mode: 'peek' });
            window.fetch = realFetch;

            return {
                requests,
                labels: [...card.querySelectorAll('.bookmark-preview-card-facts dt')].map((el) => el.textContent),
                values: [...card.querySelectorAll('.bookmark-preview-card-facts dd')].map((el) => el.textContent),
            };
        }, reportFor('https://blog.example/posts'));

        expect(drawn.requests).toBe(0);
        expect(drawn.labels.join('|')).toMatch(/uptime/i);
        expect(drawn.values.join(' ')).toContain('99.98%');
        // Six days out is worth saying; a certificate good for another year is
        // not, and stays off the card.
        expect(drawn.labels.join('|')).toMatch(/cert/i);
        expect(drawn.values.join(' ')).toMatch(/6/);
    });

    test('a certificate that is not expiring says nothing', async ({ page }) => {
        await openDashboard(page);
        const labels = await page.evaluate((report) => {
            const d = window.dashboardInstance;
            report.certificates['blog.example'].expiresAt = Date.now() + 200 * 86400000;
            window.HealthFacts.remember(report);
            const card = d.preview.ensureBookmarkPreviewCard();
            const bookmark = { name: 'Monitored', url: report.issues[0].url, openCount: 1 };
            d.preview.paintPreviewCard(card, d.preview.buildPreviewPayload(bookmark, { title: 'Monitored', url: bookmark.url }), { mode: 'peek' });
            return [...card.querySelectorAll('.bookmark-preview-card-facts dt')].map((el) => el.textContent);
        }, reportFor('https://blog.example/posts'));

        expect(labels.join('|')).toMatch(/uptime/i);
        expect(labels.join('|')).not.toMatch(/cert/i);
    });

    test('the badge fills the index on an ordinary load', async ({ page }) => {
        await openDashboard(page);
        // The health icon's own fetch is what pays for this; the card never
        // asks. On the seeded install nothing is monitored, so the index may
        // be empty — what matters is that the report was read rather than
        // dropped, which the timestamp records.
        await expect.poll(() => page.evaluate(() => window.HealthFacts?.updatedAt || 0), { timeout: 15_000 })
            .toBeGreaterThan(0);
    });
});
