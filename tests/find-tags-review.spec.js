// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, openInboxToolbarMenu,
} = require('./e2e-helpers');

/**
 * Find tags offers what it finds, and shows where.
 *
 * A round that tagged on its own said "N bookmarks got a tag" and nothing
 * more: which bookmarks it meant was nowhere to be seen. Now a round leaves
 * offers, unless "add straight away" is on, and the list it ran from keeps to
 * the rows that have one -- in the Bookmarks view, the tag view and the inbox.
 *
 * The offers come from a tag rule per site, the one source that needs neither
 * the catalogue nor the network; the online lookup answers with nothing.
 */

const STAMP = Date.now().toString(36);

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.route('**/api/tags/lookup', (route) => route.fulfill({ json: { enabled: true, results: {} } }));
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Bookmarks on the current page, and a rule for each host that should get an offer. */
async function seed(page, { bookmarks = [], inbox = [], rules = [] }) {
    await page.evaluate(async (data) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const post = (url, body) => api(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        for (const bookmark of data.bookmarks) {
            await post('/api/bookmarks/add', { page: Number(d.currentPageId), bookmark });
        }
        for (const item of data.inbox) await post('/api/inbox', item);
        d.settings.tagRules = [...(d.settings.tagRules || []), ...data.rules];
        d.settings.inboxEnabled = true;
        await d.saveSettings?.();
    }, { bookmarks, inbox, rules });
}

const serverTags = (page, url) => page.evaluate(async (href) => {
    const all = await (await fetch('/api/bookmarks?all=true')).json();
    return (Array.isArray(all) ? all : all.bookmarks || []).find((b) => b.url === href)?.tags || [];
}, url);

test.describe('Find tags shows which bookmarks it found a tag for', () => {
    let N; let OFFER; let url;

    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        OFFER = `ftr${N}`;
        url = (name) => `https://ftr-${name}-${N}.example.com/`;
        await openDashboard(page);
    });

    test('the Bookmarks view keeps the list to the rows with an offer, and adds nothing', async ({ page }) => {
        await seed(page, {
            bookmarks: [
                { name: `Ftr hit one ${N}`, url: url('one') },
                { name: `Ftr hit two ${N}`, url: url('two') },
                { name: `Ftr miss ${N}`, url: url('miss') },
            ],
            rules: [{ pattern: `ftr-one-${N}.example.com`, tag: OFFER }, { pattern: `ftr-two-${N}.example.com`, tag: OFFER }],
        });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.evaluate(() => { window.location.hash = '#bookmarks'; });
        const band = page.locator('.config-view--library .lvs-header-actions');
        await band.locator('[data-bm-header-more]').click();
        await band.locator('[data-bm-header-menu] [data-bm-header-action="tags-untagged"]').click();

        await expect(page.locator('#app-notification.show')).toContainText('have a tag suggestion');
        await expect(page.locator('#config-bm-rail .config-bm-rail-token', { hasText: 'With a tag suggestion' })).toBeVisible();
        const row = (name) => page.locator('#config-bm-list .config-bm-row', { hasText: name });
        await expect(row(`Ftr hit one ${N}`).locator(`[data-bm-offer="${OFFER}"]`)).toBeVisible();
        await expect(row(`Ftr hit two ${N}`).locator(`[data-bm-offer="${OFFER}"]`)).toBeVisible();
        await expect(row(`Ftr miss ${N}`)).toHaveCount(0);
        // Offered, not added: the tag goes on only when the chip is clicked.
        expect(await serverTags(page, url('one'))).not.toContain(OFFER);
        await row(`Ftr hit one ${N}`).locator('[data-bm-offer-add]').click();
        await expect.poll(() => serverTags(page, url('one')), { timeout: 10_000 }).toContain(OFFER);
    });

    test('the tag view keeps its rows to the ones with an offer', async ({ page }) => {
        const tag = `ftrtag${N}`;
        await seed(page, {
            bookmarks: [
                { name: `Ftr hit ${N}`, url: url('one'), tags: [tag] },
                { name: `Ftr miss ${N}`, url: url('miss'), tags: [tag] },
            ],
            rules: [{ pattern: `ftr-one-${N}.example.com`, tag: OFFER }],
        });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.evaluate((t) => window.dashboardInstance.setTagFilters([t]), tag);
        const view = page.locator('.tag-view');
        await expect(view.locator('.tag-view-row')).toHaveCount(2);
        await view.locator('[data-tag-view-find]').click();
        await expect(page.locator('.tag-view-find-menu [data-find="apply-now"]')).not.toBeChecked();
        await page.locator('.tag-view-find-menu [data-find="lookup"]').click();

        await expect(page.locator('#app-notification.show')).toContainText('has a tag suggestion');
        await expect(view.locator('[data-rail-offered]')).toHaveAttribute('aria-pressed', 'true');
        await expect(view.locator('.tag-view-row')).toHaveCount(1);
        await expect(view.locator('.tag-view-row', { hasText: `Ftr hit ${N}` })).toBeVisible();
        expect(await serverTags(page, url('one'))).not.toContain(OFFER);
        // Off again, the whole tag is back.
        await view.locator('[data-rail-offered]').click();
        await expect(view.locator('.tag-view-row')).toHaveCount(2);
    });

    test('the inbox has Find tags, and keeps to the links with an offer', async ({ page }) => {
        await seed(page, {
            inbox: [{ url: url('one'), title: `Ftr inbox hit ${N}` }, { url: url('miss'), title: `Ftr inbox miss ${N}` }],
            rules: [{ pattern: `ftr-one-${N}.example.com`, tag: OFFER }],
        });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
        await expect(page.locator('.inbox-item', { hasText: `Ftr inbox miss ${N}` })).toBeVisible({ timeout: 15_000 });
        const menu = await openInboxToolbarMenu(page);
        await menu.locator('[data-inbox-find-tags]').click();

        await expect(page.locator('#app-notification.show')).toContainText('has a tag suggestion');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.filter)).toBe('suggested');
        await expect(page.locator('.inbox-item', { hasText: `Ftr inbox hit ${N}` })).toBeVisible();
        await expect(page.locator('.inbox-item', { hasText: `Ftr inbox miss ${N}` })).toHaveCount(0);
        await expect(page.locator('.lvs-rail [data-inbox-filter="suggested"]')).toBeVisible();
    });
});
