// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A media tile after a reload: the answer from a moment ago is drawn at once,
 * with its age, and replaced when the real one arrives. Too old, or a failed
 * answer, and the tile waits as it always did.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const answer = (title) => ({
    fetchedAt: Date.now(),
    libraries: [{ id: 'lib-movies', name: 'Films' }],
    items: [{ id: 'm1', title, kind: 'movie', year: 2024, library: 'Films', libraryId: 'lib-movies', addedAt: Date.now() - 3600_000 }],
});

/**
 * Draws the tile into #held-test. With `gate` the answer is held back until
 * window.__release() is called, and the render is not awaited.
 */
async function draw(page, { result, status = 200, gate = false }) {
    await page.evaluate(async ({ result, status, gate }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        window.__release = () => release();
        window.fetch = async (url, ...rest) => {
            if (!String(url).includes('/api/widgets/jellyfin')) return realFetch(url, ...rest);
            if (gate) await held;
            return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
        };
        document.getElementById('held-test')?.remove();
        const host = document.createElement('div');
        host.id = 'held-test';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        delete d._widgetMedia; // a reload starts with nothing in memory
        window.__drawn = window.DashboardWidgets.jellyfin(body, { id: 'w_held1', type: 'jellyfin', config: {} }, d)
            .finally(() => { window.fetch = realFetch; });
        if (!gate) await window.__drawn;
    }, { result, status, gate });
    return page.locator('#held-test');
}

test('a reload draws the last answer at once, with its age, then the real one', async ({ page }) => {
    await open(page);
    let tile = await draw(page, { result: answer('Dune: Part Two') });
    await expect(tile).toContainText('Dune: Part Two');
    await expect(tile.locator('.media-stale')).toHaveCount(0);

    // "Reloaded": the service has not answered yet.
    tile = await draw(page, { result: answer('Dune: Part Three'), gate: true });
    await expect(tile).toContainText('Dune: Part Two');
    await expect(tile.locator('.media-stale')).toHaveCount(1);
    await expect(tile.locator('.dashboard-widget-waiting')).toHaveCount(0);

    await page.evaluate(() => window.__release());
    await expect(tile).toContainText('Dune: Part Three');
    await expect(tile.locator('.media-stale')).toHaveCount(0);
});

test('an answer older than ten minutes is not drawn', async ({ page }) => {
    await open(page);
    await draw(page, { result: answer('Dune: Part Two') });
    await page.evaluate(() => {
        for (let i = 0; i < sessionStorage.length; i += 1) {
            const key = sessionStorage.key(i);
            if (!key.startsWith('nextdash:media-held:')) continue;
            const held = JSON.parse(sessionStorage.getItem(key));
            held.at = Date.now() - 11 * 60 * 1000;
            sessionStorage.setItem(key, JSON.stringify(held));
        }
    });
    const tile = await draw(page, { result: answer('Dune: Part Three'), gate: true });
    await expect(tile).not.toContainText('Dune: Part Two');
    await expect(tile.locator('.dashboard-widget-waiting')).toHaveCount(1);
    await page.evaluate(() => window.__release());
});

test('a failed answer is not kept, and an unreachable service leaves the held one on screen', async ({ page }) => {
    await open(page);
    await draw(page, { result: { error: 'unreachable', items: [] } });
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('nextdash:media-held:')).length)).toBe(0);

    await draw(page, { result: answer('Dune: Part Two') });
    const tile = await draw(page, { result: {}, status: 500 });
    await expect(tile).toContainText('Dune: Part Two');
    await expect(tile.locator('.media-stale')).toHaveCount(1);
});
