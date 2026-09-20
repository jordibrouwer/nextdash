// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('Unsorted widget lists kept bookmarks, most recent first', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Older kept', url: 'https://older-kept.example', category: '', createdAt: 1000 } }),
        });
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Newer kept', url: 'https://newer-kept.example', category: '', createdAt: 2000 } }),
        });
    });

    const text = await page.evaluate(async () => {
        document.querySelectorAll('.unsorted-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unsorted-probe';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetUnsorted = null;
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: {} }, d);
        return body.textContent.replace(/\s+/g, ' ').trim();
    });

    expect(text).toContain('Newer kept');
    expect(text).toContain('Older kept');
    expect(text.indexOf('Newer kept')).toBeLessThan(text.indexOf('Older kept'));
});
