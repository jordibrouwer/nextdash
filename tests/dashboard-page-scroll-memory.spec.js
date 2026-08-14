// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Switching pages always dumped you back at the top.
 *
 * _applyLoadedPageData scrolled to 0 before every render and nothing kept the
 * offset, so returning to a long page you had been reading halfway down meant
 * finding your place again. The offset is now stored per page and consumed on
 * return — consumed rather than kept, so a fresh visit still starts at the top.
 */

const PROBE_PAGE = 'E2E scroll memory';

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/**
 * A second page to switch to, since the fixture may only have one.
 * Returns its id.
 */
async function addProbePage(page, name) {
    return page.evaluate(async (pageName) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        const list = await res.json();
        const existing = (list || []).find((p) => String(p?.name || '') === pageName);
        if (existing) return Number(existing.id);

        const nextId = Math.max(0, ...(list || []).map((p) => Number(p.id) || 0)) + 1;
        const next = [...(list || []), { id: nextId, name: pageName }];
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
        });
        await window.dashboardInstance.data.loadData({ skipPageBookmarks: true });
        return nextId;
    }, name);
}

async function removeProbePage(page, name) {
    await page.evaluate(async (pageName) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        if (!res.ok) return;
        const list = await res.json();
        const keep = (list || []).filter((p) => String(p?.name || '') !== pageName);
        if (keep.length === (list || []).length) return;
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, name).catch(() => { /* the page may already be closed */ });
}

test.describe('the dashboard remembers where you were on a page', () => {
    test.afterEach(async ({ page }) => {
        await removeProbePage(page, PROBE_PAGE);
    });

    test('an offset is stored for the page you leave', async ({ page }) => {
        await openDashboard(page);
        const otherId = await addProbePage(page, PROBE_PAGE);

        const stored = await page.evaluate(async (targetId) => {
            const d = window.dashboardInstance;
            const from = d.currentPageId;
            // Force a scrollable document: on a short fixture page the offset
            // would clamp to 0 and the assertion would pass on nothing.
            const spacer = document.createElement('div');
            spacer.style.height = '3000px';
            document.getElementById('dashboard-layout').appendChild(spacer);
            window.scrollTo({ top: 500, behavior: 'instant' });
            const reached = window.scrollY;

            await d.data.loadPageBookmarks(targetId);
            spacer.remove();
            return { reached, remembered: d._pageScrollPositions?.get(from) ?? null };
        }, otherId);

        expect(stored.reached).toBeGreaterThan(400);
        expect(stored.remembered).toBe(stored.reached);
    });

    test('coming back restores it, and it is not restored twice', async ({ page }) => {
        await openDashboard(page);
        const otherId = await addProbePage(page, PROBE_PAGE);

        const result = await page.evaluate(async (targetId) => {
            const d = window.dashboardInstance;
            const home = d.currentPageId;

            const spacer = document.createElement('div');
            spacer.style.height = '3000px';
            document.getElementById('dashboard-layout').appendChild(spacer);
            window.scrollTo({ top: 500, behavior: 'instant' });

            await d.data.loadPageBookmarks(targetId);
            const onOther = window.scrollY;

            // Coming home: the grid is short again, so keep it scrollable for
            // the restore to have somewhere to go.
            await d.data.loadPageBookmarks(home);
            document.getElementById('dashboard-layout').appendChild(spacer);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => setTimeout(resolve, 100));
            const restored = window.scrollY;

            spacer.remove();
            return { onOther, restored, leftOver: d.data.takeRememberedScroll(home) };
        }, otherId);

        // The new page opened at the top...
        expect(result.onOther).toBe(0);
        // ...and the old one came back where it was.
        expect(result.restored).toBeGreaterThan(400);
        // Restoring consumed the entry, so a later plain visit starts at the top.
        expect(result.leftOver).toBe(0);
    });

    test('a page with nothing remembered is not scrolled', async ({ page }) => {
        await openDashboard(page);
        expect(await page.evaluate(
            () => window.dashboardInstance.data.takeRememberedScroll(99999))).toBe(0);
    });

    test('nothing is remembered while another view is open', async ({ page }) => {
        await openDashboard(page);
        const remembered = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const view = d.activeView;
            d.activeView = 'config';
            d._pageScrollPositions = new Map();
            d.data.rememberScrollForPage(d.currentPageId);
            const inConfig = d._pageScrollPositions.size;
            d.activeView = view;
            return inConfig;
        });
        expect(remembered).toBe(0);
    });
});
