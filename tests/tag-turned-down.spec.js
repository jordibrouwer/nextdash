// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
} = require('./e2e-helpers');

/**
 * What was turned down can be found again, from where it was turned down.
 *
 * The refusals lived only at the foot of Config → Bookmarks → Tag suggestions,
 * folded shut. Every list that offers tags now says "N turned down" beside its
 * offers, and that opens the list with Turned down open; past ten refusals the
 * list has a field to find one by site or tag.
 *
 * The offers come from a tag rule per site, so no catalogue or network is
 * needed; the online lookup answers with nothing.
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

async function seed(page, { bookmarks = [], inbox = [], rules = [], dismissed = [] }) {
    await page.evaluate(async (data) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const post = (url, body) => api(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        for (const bookmark of data.bookmarks) await post('/api/bookmarks/add', { page: Number(d.currentPageId), bookmark });
        for (const item of data.inbox) await post('/api/inbox', item);
        d.settings.tagRules = [...(d.settings.tagRules || []), ...data.rules];
        d.settings.dismissedTagSuggestions = [...(d.settings.dismissedTagSuggestions || []), ...data.dismissed];
        d.settings.inboxEnabled = true;
        await d.saveSettings?.();
    }, { bookmarks, inbox, rules, dismissed });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const dismissed = (page) => page.evaluate(async () => (await (await fetch('/api/settings')).json()).dismissedTagSuggestions || []);
const turnedDown = (page) => page.locator('[data-tag-suggestions-dismissed]');

test.describe('turned-down tag suggestions', () => {
    let N; let OFFER; let host;

    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        OFFER = `td${N}`;
        host = `td-one-${N}.example.com`;
        await openDashboard(page);
    });

    test('a refusal in the Bookmarks view can be found from there and offered again', async ({ page }) => {
        await seed(page, {
            bookmarks: [{ name: `Td one ${N}`, url: `https://${host}/` }],
            rules: [{ pattern: host, tag: OFFER }],
        });
        await page.evaluate(() => { window.location.hash = '#bookmarks'; });
        const row = page.locator('#config-bm-list .config-bm-row', { hasText: `Td one ${N}` });
        await row.locator(`[data-bm-offer="${OFFER}"] [data-bm-offer-refuse]`).click();
        await expect.poll(() => dismissed(page)).toContain(`${host}|${OFFER}`);

        const link = page.locator('#config-bm-offers [data-bm-offers-refused]');
        await expect(link).toContainText('turned down');
        await link.click();
        await expect(turnedDown(page)).toHaveJSProperty('open', true);
        const entry = turnedDown(page).locator(`[data-tag-suggestion-refused="${host}|${OFFER}"]`);
        await expect(entry).toBeVisible();
        await entry.locator('[data-tag-suggestion-restore-one]').click();
        await expect.poll(() => dismissed(page)).not.toContain(`${host}|${OFFER}`);
    });

    test('the tag view and the inbox lead there too', async ({ page }) => {
        const tag = `tdtag${N}`;
        await seed(page, {
            bookmarks: [{ name: `Td tagged ${N}`, url: `https://td-two-${N}.example.com/`, tags: [tag] }],
            inbox: [{ url: `https://td-three-${N}.example.com/`, title: `Td inbox ${N}` }],
            dismissed: [`${host}|${OFFER}`],
        });
        await page.evaluate((t) => window.dashboardInstance.setTagFilters([t]), tag);
        const viewLink = page.locator('.tag-view [data-tag-view-offers-refused]');
        await expect(viewLink).toBeVisible();
        await viewLink.click();
        await expect(turnedDown(page)).toHaveJSProperty('open', true);

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        const inboxLink = page.locator('.inbox-layout [data-inbox-offers-refused]');
        await expect(inboxLink).toBeVisible();
        await inboxLink.click();
        await expect(turnedDown(page)).toHaveJSProperty('open', true);
    });

    test('the Tag suggestions tab itself leads down to Turned down', async ({ page }) => {
        await seed(page, { dismissed: [`${host}|${OFFER}`] });
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config.openConfigView('bookmarks');
            const config = d.config.instance || d.config;
            config._tagSuggestionsRefusedOpen = false;
            config.bmTab = 'tag-suggestions';
            config.render();
        });
        await expect(turnedDown(page)).toHaveJSProperty('open', false);
        await page.locator('[data-tag-suggestions-facts] [data-tag-suggestions-refused-jump]').click();
        await expect(turnedDown(page)).toHaveJSProperty('open', true);
        await expect(turnedDown(page).locator(`[data-tag-suggestion-refused="${host}|${OFFER}"]`)).toBeInViewport();
    });

    test('past ten refusals the list can be searched, and the search holds through a redraw', async ({ page }) => {
        const many = Array.from({ length: 12 }, (_, i) => `td-many-${i}-${N}.example.com|tdmany${i}`);
        await seed(page, { dismissed: many });
        await page.evaluate(() => window.TagSuggestLive.openRefused(window.dashboardInstance));
        const field = turnedDown(page).locator('[data-tag-suggestions-refused-search]');
        await field.fill(`#tdmany1${''}`);
        const shown = turnedDown(page).locator('[data-tag-suggestion-refused]:visible');
        // tdmany1, tdmany10, tdmany11
        await expect(shown).toHaveCount(3);
        await shown.filter({ hasText: '#tdmany10' }).locator('[data-tag-suggestion-restore-one]').click();
        await expect.poll(() => dismissed(page)).not.toContain(many[10]);
        await expect(turnedDown(page).locator('[data-tag-suggestions-refused-search]')).toHaveValue('#tdmany1');
        await expect(turnedDown(page).locator('[data-tag-suggestion-refused]:visible')).toHaveCount(2);
    });
});
