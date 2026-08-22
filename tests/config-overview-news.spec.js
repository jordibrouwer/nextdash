// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * One dated stream where there used to be three answers to "what is new".
 *
 * The overview carried a carousel showing one of forty-nine feature spotlights
 * at a time, a Latest update panel repeating the release the bar above it had
 * already named, and — once the site's feed arrived — a third list beside them.
 * Three visual weights, three scopes, and the site's posts starting at 936px on
 * a 900px screen.
 *
 * Now: posts, releases and new settings in one list, newest first, each row
 * saying where it came from and openable on its own. What was pushed out is
 * pinned here — the figures about your own install moved to the side column,
 * which is what lifts the stream above the fold.
 */

const POSTS = [
    { title: 'Hover cards in nextDash v1.3.2', url: 'https://nextdash.cc/2026/08/21/hover-cards/', summary: 'The card answers three things in the same order every time.', publishedAt: Date.UTC(2026, 7, 21, 14, 7) },
    { title: 'Fresh: the bookmarks that have something new', url: 'https://nextdash.cc/2026/08/21/fresh/', summary: 'Your saved links publish; Fresh counts what appeared.', publishedAt: Date.UTC(2026, 7, 21, 9, 12) },
    { title: 'A title long enough that no side-by-side column could ever show all of it without clipping somewhere along the way', url: 'https://nextdash.cc/2026/08/19/long/', summary: 'Decay, drift, and the moment a bookmark stops being worth keeping.', publishedAt: Date.UTC(2026, 7, 19, 11, 17) },
];

async function openOverviewWith(page, items, { enabled = true } = {}) {
    await page.route('**/api/site-news*', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ enabled, items, fetchedAt: Date.now() }),
    }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Settings persist server-side between specs, and one test below clears
    // this one deliberately, so each test sets the state it needs.
    await page.evaluate(() => window.dashboardInstance.config.setBehavior('showSiteNews', true, 'siteNews'));
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.waitForSelector('.config-overview-layout', { timeout: 15_000 });
}

test.describe('the news stream', () => {
    test('mixes the three sources, newest first, each row saying which', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        const rows = page.locator('.config-news-item');
        await expect(rows.first()).toBeVisible({ timeout: 15_000 });

        const read = await page.evaluate(() => {
            const items = [...document.querySelectorAll('.config-news-item')];
            return items.map((el) => ({
                source: el.getAttribute('data-news-source'),
                title: el.querySelector('.config-news-title')?.textContent.trim(),
                when: el.querySelector('.config-news-when')?.textContent.trim(),
            }));
        });

        // Six rows, and more than one kind of thing in them: a list of only
        // releases would be a changelog, of only posts an advert.
        expect(read.length).toBeGreaterThan(1);
        expect(new Set(read.map((r) => r.source)).size).toBeGreaterThan(1);
        expect(read.every((r) => r.title && r.when)).toBe(true);
        // The newest post leads, because everything carries a date now.
        expect(read[0].title).toContain('Hover cards');
    });

    test('the source chips narrow it, and say how much of each there is', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        await expect(page.locator('.config-news-item').first()).toBeVisible({ timeout: 15_000 });

        const chips = page.locator('.config-src-filter');
        await expect(chips).toHaveCount(4);

        await page.locator('[data-news-filter="site"]').click();
        await expect.poll(() => page.locator('.config-news-item').evaluateAll((els) =>
            [...new Set(els.map((el) => el.getAttribute('data-news-source')))])).toEqual(['site']);
        // This is what keeps a news block in a self-hosted tool from reading as
        // marketing: the site's posts can be filtered out from the row itself.
        await page.locator('[data-news-filter="release"]').click();
        await expect.poll(() => page.locator('.config-news-item').evaluateAll((els) =>
            [...new Set(els.map((el) => el.getAttribute('data-news-source')))])).toEqual(['release']);
        // Pressing the active chip again goes back to everything.
        await page.locator('[data-news-filter="release"]').click();
        await expect.poll(() => page.locator('.config-news-item').evaluateAll((els) =>
            [...new Set(els.map((el) => el.getAttribute('data-news-source')))].length))
            .toBeGreaterThan(1);
    });

    test('the rows line up: one label width, one title edge, one date edge', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        await expect(page.locator('.config-news-item').first()).toBeVisible({ timeout: 15_000 });

        const edges = await page.evaluate(() => {
            const round = (n) => Math.round(n);
            return {
                // Each row is its own grid, so an `auto` label column sized
                // itself per row: nextdash.cc is twice the width of release,
                // and every title started somewhere else down the list.
                chipWidths: [...new Set([...document.querySelectorAll('.config-src-chip')]
                    .map((el) => round(el.getBoundingClientRect().width)))],
                titleLefts: [...new Set([...document.querySelectorAll('.config-news-title')]
                    .map((el) => round(el.getBoundingClientRect().left)))],
                dateRights: [...new Set([...document.querySelectorAll('.config-news-when')]
                    .map((el) => round(el.getBoundingClientRect().right)))],
            };
        });

        expect(edges.chipWidths).toHaveLength(1);
        expect(edges.titleLefts).toHaveLength(1);
        expect(edges.dateRights).toHaveLength(1);
    });

    test('a post opens on the site, in a new tab', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        const post = page.locator('.config-news-item[data-news-source="site"]').first();
        await expect(post).toBeVisible({ timeout: 15_000 });
        const link = post.locator('.config-news-go');
        await expect(link).toHaveAttribute('href', POSTS[0].url);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
    });

    test('the date follows the format the reader chose', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        await expect(page.locator('.config-news-item').first()).toBeVisible({ timeout: 15_000 });

        const withFormat = async (format) => {
            await page.evaluate((f) => {
                const d = window.dashboardInstance;
                d.settings.dateFormat = f;
                d.config.repaintOverview();
            }, format);
            return (await page.locator('.config-news-when').first().innerText()).trim();
        };

        expect(await withFormat('iso')).toBe('2026-08-21');
        expect(await withFormat('short-slash')).toBe('21/08/2026');
        expect(await withFormat('mm-slash')).toBe('08/21/2026');
    });

    test('the site being unreachable leaves the rest of the stream standing', async ({ page }) => {
        await openOverviewWith(page, []);
        await expect(page.locator('.config-news-item').first()).toBeVisible({ timeout: 15_000 });
        // Releases and features need no network, so a NAS behind a firewall
        // still gets a stream — just without the site's half of it.
        const sources = await page.locator('.config-news-item')
            .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-news-source')))]);
        expect(sources).not.toContain('site');
        expect(sources.length).toBeGreaterThan(0);
    });

    test('the drill-in carries everything the overview left out', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        await expect(page.locator('.config-news-item').first()).toBeVisible({ timeout: 15_000 });
        const onOverview = await page.locator('.config-news-item').count();

        await page.locator('[data-overview-go*="aboutTab"]').click();
        await page.waitForSelector('#config-about-body .config-news-item', { timeout: 15_000 });

        expect(await page.evaluate(() => window.dashboardInstance.config.aboutTab)).toBe('news');
        const inDrillIn = await page.locator('#config-about-body .config-news-item').count();
        // The overview shows six; the drill-in shows the stream in full plus
        // the undated back catalogue of features.
        expect(inDrillIn).toBeGreaterThan(onOverview);
        await expect(page.locator('#config-about-body')).toContainText(/switch on/i);
    });
});

test.describe('the switch under Behavior → Privacy', () => {
    async function openPrivacy(page) {
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.openConfigView('behavior');
            c.behaviorTab = 'privacy';
            c.render();
        });
        await page.waitForSelector('[data-behavior-field="showSiteNews"]', { timeout: 15_000 });
    }

    test('it sits beside the other two outbound requests, and stops the fetch', async ({ page }) => {
        let asked = 0;
        await page.route('**/api/site-news*', (route) => {
            asked += 1;
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, items: POSTS }) });
        });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.setBehavior('showSiteNews', true, 'siteNews'));

        await openPrivacy(page);
        // Analytics, the GitHub update check, and this: the three things that
        // leave the machine, in one place.
        const panel = page.locator('.config-panel').filter({ has: page.locator('[data-behavior-field="showSiteNews"]') });
        await expect(panel.locator('[data-behavior-field="analyticsOptIn"]')).toHaveCount(1);
        await expect(panel.locator('[data-behavior-field="updateCheckEnabled"]')).toHaveCount(1);
        await expect(page.locator('[data-behavior-field="showSiteNews"]')).toBeChecked();

        await page.locator('[data-behavior-field="showSiteNews"]').uncheck();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.showSiteNews), { timeout: 10_000 })
            .toBe(false);

        const before = asked;
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForSelector('.config-news-panel', { timeout: 15_000 });
        await page.waitForTimeout(1200);
        // Cleared means the request is never made, not made and hidden.
        expect(asked).toBe(before);
        const sources = await page.locator('.config-news-item')
            .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-news-source')))]);
        expect(sources).not.toContain('site');
    });

    test('turning it back on brings the posts back without reopening config', async ({ page }) => {
        await openOverviewWith(page, POSTS);
        await expect(page.locator('.config-news-item[data-news-source="site"]').first()).toBeVisible({ timeout: 15_000 });

        await openPrivacy(page);
        await page.locator('[data-behavior-field="showSiteNews"]').uncheck();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.showSiteNews)).toBe(false);
        await page.locator('[data-behavior-field="showSiteNews"]').check();

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        // Without forgetting the promise the off state left behind, the stream
        // would stay site-less until config was reopened — a switch that looks
        // like it does not work.
        await expect(page.locator('.config-news-item[data-news-source="site"]').first())
            .toBeVisible({ timeout: 15_000 });
    });
});
