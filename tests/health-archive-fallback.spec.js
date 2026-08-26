// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Two archives, one button.
 *
 * The Web Archive honours a robots.txt that turns it away and drops what a site
 * later withdraws; archive.today captures on request and keeps what it
 * captured. So "no copy" from the first is not "no copy", and for a link that
 * died behind a paywall or a takedown it is usually the second that has it.
 *
 * A second menu entry would have made the reader decide which service keeps
 * what before they can press anything. The same button falls through instead —
 * and only on the way to an empty answer, so a page the first archive holds
 * costs no extra request.
 */

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/**
 * Run recoverFromArchive against stubbed archives and report what it asked and
 * what it said. Answering the confirm with "no" opens the capture, which is the
 * branch that needs no write.
 */
async function recover(page, { wayback, today }) {
    return page.evaluate(async ({ wayback, today }) => {
        const d = window.dashboardInstance;
        /*
         * d.health is a lazy loader that fetches the real module on first use
         * and forwards every call to it. Stubbing a method on the loader --
         * or on its prototype -- therefore changes nothing: the call still
         * resolves against the loaded object. Load it, then work with that.
         */
        await d.health.load?.();
        const health = d.health.instance || d.health;
        const asked = [];
        const realFetch = window.fetch;
        let confirmBody = '';
        let opened = '';
        let notice = '';

        window.fetch = async (url, ...rest) => {
            const href = String(url);
            if (href.includes('/api/health/archive-snapshot')) {
                asked.push('wayback');
                return new Response(JSON.stringify(wayback), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (href.includes('/api/health/archive-today')) {
                asked.push('today');
                return new Response(JSON.stringify(today), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(url, ...rest);
        };
        // Left unstubbed the real dialog opens and the flow waits for a click
        // that never comes.
        const realConfirm = health.confirm;
        health.confirm = async (_title, body) => { confirmBody = String(body || ''); return false; };
        const realOpen = window.open;
        window.open = (href) => { opened = String(href || ''); return null; };
        const realNotify = d.showNotification;
        d.showNotification = (text) => { notice = String(text || ''); };

        try {
            await health.recoverFromArchive({ url: 'https://example.com/gone', pageId: 'p', index: 0 });
        } finally {
            window.fetch = realFetch;
            health.confirm = realConfirm;
            window.open = realOpen;
            d.showNotification = realNotify;
        }
        return { asked, confirmBody, opened, notice };
    }, { wayback, today });
}

const AVAILABLE_TODAY = {
    available: true,
    url: 'https://archive.ph/20260324065815/https://example.com/gone',
    timestamp: Date.UTC(2026, 2, 24),
    captures: 8,
    mirror: 'https://archive.ph',
};

test.describe('recovering from either archive', () => {
    test('the second archive is asked only when the first has nothing', async ({ page }) => {
        await openHealth(page);
        const r = await recover(page, {
            wayback: { available: false },
            today: AVAILABLE_TODAY,
        });
        expect(r.asked).toEqual(['wayback', 'today']);
        // The offer names which archive answered, so the date means something.
        expect(r.confirmBody).toContain('archive.today');
        expect(r.confirmBody).toContain('archive.ph/20260324065815');
        // Declining still opens the capture — it is worth seeing either way.
        expect(r.opened).toContain('archive.ph/20260324065815');
    });

    test('a page the Web Archive holds costs no second request', async ({ page }) => {
        await openHealth(page);
        const r = await recover(page, {
            wayback: {
                available: true,
                url: 'https://web.archive.org/web/20240101/https://example.com/gone',
                timestamp: Date.UTC(2024, 0, 1),
            },
            today: AVAILABLE_TODAY,
        });
        expect(r.asked).toEqual(['wayback']);
        expect(r.opened).toContain('web.archive.org');
    });

    test('neither archive holding a copy says so once', async ({ page }) => {
        await openHealth(page);
        const r = await recover(page, {
            wayback: { available: false },
            today: { available: false },
        });
        expect(r.asked).toEqual(['wayback', 'today']);
        expect(r.opened).toBe('');
        // Not "the Web Archive has no copy" — both were asked.
        expect(r.notice.toLowerCase()).toMatch(/neither|either|both/);
    });
});
