// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The add-bookmark modal builds its Page dropdown from the handler's context.
 * Only `:new`, quick-add and config used to set it, so every other entry point
 * — inbox promote, paste-a-URL, the search hint, the toolbar, the empty state —
 * opened the modal with whatever the previous caller had left, and on a fresh
 * load with nothing at all, which falls back to one hardcoded "Dashboard"
 * option and hides every real page. openModal now refreshes it itself.
 */
async function twoPages(page) {
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetch('/api/pages');
        const pages = res.ok ? await res.json() : [];
        if (!pages.some((p) => p.name === 'promote-spec-page')) {
            const id = Math.max(0, ...pages.map((p) => Number(p.id) || 0)) + 1;
            pages.push({ id, name: 'promote-spec-page', icon: '' });
            await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pages),
            });
        }
    });
    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const pageOptions = (page) => page.evaluate(() => {
    const sel = document.querySelector('#bookmark-form-modal .bookmark-inline-form .bookmark-inline-select:not(.bookmark-inline-toggle-select)');
    return sel ? [...sel.options].map((o) => o.textContent.trim()) : [];
});

const pinnedPageValue = (page) => page.evaluate(() => {
    const sel = document.querySelector('#bookmark-form-modal .bookmark-inline-form .bookmark-inline-select:not(.bookmark-inline-toggle-select)');
    return sel ? Number(sel.value) : NaN;
});

test.describe('add-bookmark modal page dropdown', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await twoPages(page);
    });

    test('promoting an inbox item offers every page', async ({ page }) => {
        const stamp = Date.now();
        await page.evaluate(async (s) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://promote-${s}.example.com`, title: 'Promote me' }),
            });
        }, stamp);
        await page.evaluate(() => window.dashboardInstance.inbox?.openInboxView?.());
        await expect.poll(async () => page.evaluate((s) => {
            const items = window.dashboardInstance.inbox?.items || [];
            return items.some((i) => String(i.url).includes(String(s)));
        }, stamp), { timeout: 10_000 }).toBe(true);

        await page.evaluate((s) => {
            const inbox = window.dashboardInstance.inbox;
            const item = (inbox.items || []).find((i) => String(i.url).includes(String(s)));
            inbox.promoteItem(item);
        }, stamp);

        await expect.poll(() => pageOptions(page), { timeout: 10_000 })
            .toContain('promote-spec-page');
        // And the real page names, not the hardcoded "Dashboard" fallback.
        expect(await pageOptions(page)).toContain('main');

        // Clean up the inbox item this test seeded.
        await page.evaluate(async (s) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/inbox');
            const body = res.ok ? await res.json() : null;
            const items = Array.isArray(body) ? body : (body?.items || []);
            for (const it of items) {
                if (String(it?.url || '').includes(String(s))) {
                    await api(`/api/inbox?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' });
                }
            }
        }, stamp);
    });

    test('opening the modal directly on a fresh load offers every page', async ({ page }) => {
        // No :new or quick-add first, so nothing has set the context.
        await page.evaluate(() => {
            const h = window.dashboardInstance.searchComponent?.commandsComponent?.newCommandHandler;
            h.openModal({ url: 'https://example.com/direct' });
        });
        await expect.poll(() => pageOptions(page), { timeout: 10_000 })
            .toContain('promote-spec-page');
    });

    test('a caller that pins a page keeps it', async ({ page }) => {
        // Config opens the modal on the page it is editing, not the page the
        // dashboard shows; setContext marks that and openModal must not override.
        const pinned = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const h = d.searchComponent?.commandsComponent?.newCommandHandler;
            const other = (d.pages || []).find((p) => Number(p.id) !== Number(d.currentPageId));
            h.setContext(Number(other.id), d.categories || [], d.pages || []);
            h.openModal({});
            return Number(other.id);
        });
        await expect.poll(async () => pinnedPageValue(page), { timeout: 10_000 })
            .toBe(pinned);
    });
});
