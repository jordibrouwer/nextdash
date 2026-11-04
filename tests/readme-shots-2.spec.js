// @ts-check
/*
 * README screenshots, set 2: the Bookmarks view, collection health, the inbox
 * and its triage, the weekly digest and the search panel. Full 1920x1200
 * frames, each in the built-in theme its README caption names, over the demo seed.
 */
const { test, prepare, settle, shot, openDashboard, BROKEN_HOSTS } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: { width: 1920, height: 1200 }, reducedMotion: 'reduce' });
test.setTimeout(120_000);

async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
}

async function openInbox(page) {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await page.locator('.inbox-layout').waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
}

test.describe('bookmarks view', () => {
    test.use({ shotTheme: 'oceanic-steel-light' });
    test('bookmarks view', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-list .config-bm-row', { hasText: 'github.com' }).first().click();
        await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
        await page.mouse.move(700, 400);
        await page.mouse.wheel(0, -3000);
        // Pacing for the capture, not a condition: the panel finishes sliding in.
        await page.waitForTimeout(1_000);
        await shot(page, 'readme/nextdash-bookmarks-view.jpg');
    });
});

test.describe('broken', () => {
    test.use({ shotTheme: 'oxblood-leather-dark', dataPatch: 'broken' });
    test('broken bookmarks', async ({ page }) => {
        await prepare(page);
        await page.route('**/api/ping?**', (route) => {
            const url = new URL(route.request().url()).searchParams.get('url') || '';
            if (!BROKEN_HOSTS.some((h) => url.includes(h))) return route.fallback();
            return route.fulfill({ json: { status: 'offline', ping: null, error: url.includes('podcast') ? 'DNS lookup failed' : 'HTTP 404' } });
        });
        await openBookmarksView(page);
        await page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]').click();
        await page.waitForTimeout(800);
        await page.locator('#config-bm-list .config-bm-row', { hasText: 'podcast.example.net' }).first().click();
        await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the panel finishes sliding in.
        await page.waitForTimeout(1_000);
        await shot(page, 'readme/nextdash-bookmarks-health.jpg');
    });
});

test.describe('collection health', () => {
    test.use({ shotTheme: 'salt-flat-light', dataPatch: 'broken' });
    test('collection health', async ({ page }) => {
        await prepare(page);
        await openBookmarksView(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('h');
        await page.locator('#app-modal.show').waitFor();
        // Pacing for the capture, not a condition: the charts finish drawing.
        await page.waitForTimeout(1_500);
        await shot(page, 'readme/nextdash-collection-health.jpg');
    });
});

test.describe('inbox', () => {
    test.use({ shotTheme: 'paper-ink-light' });
    test('inbox', async ({ page }) => {
        await prepare(page);
        await openInbox(page);
        // The unread links only, so the list is short enough for the keys under it to show.
        await page.locator('.inbox-layout').getByText('Unread', { exact: true }).first().click();
        await page.locator('.inbox-layout').getByText('Jellyfin documentation').first().click();
        await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the panel finishes sliding in.
        await page.waitForTimeout(800);
        await shot(page, 'readme/nextdash-inbox.jpg');
    });
});

test.describe('triage', () => {
    test.use({ shotTheme: 'royal-amethyst-dark' });
    test('triage', async ({ page }) => {
        await prepare(page);
        await openInbox(page);
        await page.locator('.inbox-triage-btn').click();
        await page.locator('#inbox-triage-overlay').waitFor();
        // Pacing for the capture, not a condition: the pile chooser finishes drawing.
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        // Pacing for the capture, not a condition: the card finishes drawing.
        await page.waitForTimeout(1_000);
        await shot(page, 'readme/nextdash-triage.jpg');
    });
});

test.describe('digest', () => {
    test.use({ shotTheme: 'oceanic-steel-dark' });
    test('digest', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        const res = await page.request.post('/api/digest/test');
        test.skip(res.status() === 204, 'the seed has nothing to put in a digest');
        await page.keyboard.press(':');
        await page.keyboard.type('digest');
        await page.keyboard.press('Enter');
        await page.locator('.digest-modal .digest-window').waitFor({ timeout: 15_000 });
        // Pacing for the capture, not a condition: the window finishes drawing.
        await page.waitForTimeout(1_200);
        await shot(page, 'readme/nextdash-digest.jpg');
    });
});

test.describe('search', () => {
    test.use({ shotTheme: 'porcelain-blue-light' });
    test('search', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // Bare letters look for a shortcut first; / turns the same letters into a name search.
        await page.keyboard.type('immich', { delay: 120 });
        await page.keyboard.press('/');
        await page.locator('#shortcut-search .search-container').waitFor();
        // Pacing for the capture, not a condition: the results finish drawing.
        await page.waitForTimeout(1_000);
        await shot(page, 'readme/nextdash-search.jpg');
    });
});

test.describe('search tags', () => {
    test.use({ shotTheme: 'neon-grid-dark' });
    test('search by tag', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.type('tag:self-hosted', { delay: 60 });
        await page.locator('#shortcut-search .search-container').waitFor();
        // Pacing for the capture, not a condition: the results finish drawing.
        await page.waitForTimeout(1_000);
        await shot(page, 'readme/nextdash-search-tags.jpg');
    });
});

test.describe('commands', () => {
    test.use({ shotTheme: 'thinkdashboard-classic-dark' });
    test('docker commands', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press(':');
        await page.keyboard.type('docker', { delay: 60 });
        await page.locator('#shortcut-search .search-container').waitFor();
        // Pacing for the capture, not a condition: the results finish drawing.
        await page.waitForTimeout(1_000);
        await shot(page, 'readme/nextdash-commands.jpg');
    });
});
