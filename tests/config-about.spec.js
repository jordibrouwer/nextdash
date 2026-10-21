// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The About section of config.
 *
 * It is the one place in the app that says what nextDash is and where it comes
 * from, and all three of those things — the wordmark, the project site, the
 * author's site — are markup that only appears when someone opens this tab. A
 * logo that 404s still renders as an alt-text stub, so the image is checked for
 * having actually decoded rather than for being in the DOM.
 */

async function openAbout(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    // Its own section since it stopped being a tab of Help.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('about'));
    await page.waitForSelector('#config-section-panel .config-about-hero', { timeout: 15_000 });
}

test.describe('config about', () => {
    test('shows the wordmark, decoded rather than merely present', async ({ page }) => {
        await openAbout(page);

        const mark = page.locator('.help-about-mark img');
        await expect(mark).toBeVisible();
        await expect(mark).toHaveAttribute('alt', 'nextDash');

        const state = await mark.evaluate((img) => ({
            complete: img.complete,
            natural: img.naturalWidth,
            width: Math.round(img.getBoundingClientRect().width),
        }));
        expect(state.complete).toBe(true);
        // A broken src leaves naturalWidth at 0 while the element still lays out.
        expect(state.natural).toBeGreaterThan(0);
        expect(state.width).toBeGreaterThan(100);
    });

    test('the hero offers the six links, each once, and the maker address once', async ({ page }) => {
        await openAbout(page);

        const hero = page.locator('.config-about-hero');
        const hrefs = await hero.locator('a[href]').evaluateAll((links) =>
            links.map((a) => a.getAttribute('href') || ''));
        const expected = [
            'https://github.com/jordibrouwer/nextDash',
            'https://nextdash.cc',
            'https://nextdash.cc/docs/',
            'https://github.com/jordibrouwer/nextDash/issues',
            'https://github.com/jordibrouwer/nextdash/blob/main/CHANGELOG.md',
            'https://github.com/jordibrouwer/nextdash/blob/main/MANUAL.md',
        ];
        for (const href of expected) expect(hrefs.filter((h) => h === href), href).toHaveLength(1);
        expect(hrefs.some((h) => h.includes('discussions'))).toBe(false);

        // jordibrw.nl is the maker card's, once in the whole pane.
        const pane = page.locator('#config-section-panel');
        await expect(pane.locator('a[href*="jordibrw.nl"]')).toHaveCount(1);
        await expect(page.locator('[data-about-card="maker"] a[href*="jordibrw.nl"]')).toHaveCount(1);

        // Opening someone else's site in this tab would take the dashboard with
        // it, and rel is what keeps the new tab from reaching back.
        const rels = await pane.locator('a[href^="http"]').evaluateAll((links) =>
            links.map((a) => [a.getAttribute('target'), a.getAttribute('rel')]));
        for (const [target, rel] of rels) {
            expect(target).toBe('_blank');
            expect(rel).toBe('noopener noreferrer');
        }
    });

    test('four cards: why, Ko-fi, maker and roadmap', async ({ page }) => {
        await openAbout(page);
        const ids = await page.locator('.config-about-cards [data-about-card]').evaluateAll((els) =>
            els.map((e) => e.getAttribute('data-about-card')));
        expect(ids).toEqual(['why', 'kofi', 'maker', 'roadmap']);

        await expect(page.locator('[data-about-card="kofi"] a[href="https://ko-fi.com/jordibrw"]')).toHaveCount(1);
        await expect(page.locator('[data-about-card="roadmap"] a[href^="http"]')).toHaveCount(1);
        // A missing locale key would render as its own name.
        await expect(page.locator('.config-about-cards')).not.toContainText('config.about');
        await expect(page.locator('.config-about-hero')).not.toContainText('config.about');
    });

    test('credits start collapsed at the bottom', async ({ page }) => {
        await openAbout(page);
        const credits = page.locator('details[data-about-credits]');
        await expect(credits).toHaveCount(1);
        expect(await credits.evaluate((d) => d.open)).toBe(false);
    });

    test('a saved location of about/colophon opens the Project tab', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('nextdash:config-last-location-v1',
                JSON.stringify({ section: 'about', subTab: 'colophon', savedAt: Date.now() }));
        });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await expect(page.locator('[data-about-tab][aria-selected="true"]')).toHaveAttribute('data-about-tab', 'project');
    });

    test('credits the app icon sets, with a link to each and to the CC BY licence', async ({ page }) => {
        await openAbout(page);

        await page.locator('[data-about-credits] > summary').click();
        const credits = page.locator('[data-about-icon-credits]');
        await expect(credits).toContainText('dashboard-icons');
        await expect(credits).toContainText('selfh.st/icons');
        await expect(credits.locator('a[href="https://github.com/homarr-labs/dashboard-icons"]')).toBeVisible();
        await expect(credits.locator('a[href="https://github.com/selfhst/icons"]')).toBeVisible();
        await expect(credits.locator('a[href="https://creativecommons.org/licenses/by/4.0/"]')).toHaveText('CC BY 4.0');
    });

    test('credits uPlot, the charts\' library, with its licence', async ({ page }) => {
        await openAbout(page);
        await page.locator('[data-about-credits] > summary').click();
        const credits = page.locator('[data-about-chart-credits]');
        await expect(credits.locator('a[href="https://github.com/leeoniya/uPlot"]')).toHaveText('uPlot');
        await expect(credits).toContainText('MIT');
    });
});

test.describe('config about credits and licences', () => {
    test('the licence list loads once, on first open', async ({ page }) => {
        let hits = 0;
        page.on('request', (r) => { if (r.url().includes('/static/data/licenses.json')) hits += 1; });
        await openAbout(page);
        expect(hits).toBe(0);
        const credits = page.locator('details[data-about-credits]');
        await credits.locator('summary').click();
        await expect(credits.locator('.config-about-licence-list li').first()).toBeVisible();
        await expect(credits).toContainText('nextDash');
        await expect(credits).toContainText('uPlot');
        await expect(credits.locator('li').filter({ hasText: /MIT|Apache|BSD/ }).first()).toBeVisible();
        await credits.locator('summary').click();
        await credits.locator('summary').click();
        expect(hits).toBe(1);
    });

    test('a missing list says so and leaves the rest of Project alone', async ({ page }) => {
        await page.route('**/static/data/licenses.json', (route) => route.fulfill({ status: 404, body: '' }));
        await openAbout(page);
        await page.locator('details[data-about-credits] summary').click();
        await expect(page.locator('[data-about-licences]')).toContainText('could not be loaded');
        await expect(page.locator('[data-about-card="why"]')).toBeVisible();
        await expect(page.locator('[data-about-icon-credits]')).toBeVisible();
    });
});

test.describe('config about news tab', () => {
    test('News keeps its stream and filters inside the new wrapper', async ({ page }) => {
        await openAbout(page);
        await page.evaluate(() => { const c = window.dashboardInstance.config; c.aboutTab = 'news'; c.render(); });
        await expect(page.locator('.config-about-news .config-news-chips')).toBeVisible();
        await expect(page.locator('.config-about-news .config-news-stream').first()).toBeVisible();
    });
});
