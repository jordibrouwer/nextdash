// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * A container's web UI and the bookmark for it. By hand first, then the same
 * port on this server, a subdomain named after it, a bookmark titled after it;
 * two candidates at one step is no match. The table shows the bookmark's
 * health as a ring before the web UI link; its side panel can pick another or
 * none; the bookmark's own panel says which container it runs in.
 */

const row = (name, extra = {}) => ({ id: name.padEnd(64, '0'), shortId: name.padEnd(12, '0'), name, image: `x/${name}`, tag: 'latest',
    state: 'running', status: 'Up', health: '', created: 1790000000, ports: [], ...extra });

const CONTAINERS = [
    row('sonarr', { ports: [{ private: 8989, public: 8989, type: 'tcp' }], webui: 'http://[IP]:8989/' }),
    row('radarr', { ports: [{ private: 7878, public: 7878, type: 'tcp' }] }),
    row('bazarr'),
    row('jellyfin', { ports: [{ private: 8096, public: 8096, type: 'tcp' }] }),
    row('plex'),
];

const BOOKMARKS = [
    { name: 'Sonarr', url: 'http://localhost:8989/', pageId: 1, category: 'c1', checkStatus: true },
    { name: 'Movies', url: 'https://radarr.example.com/', pageId: 1, category: 'c1', checkStatus: false },
    { name: 'Bazarr', url: 'https://tools.example.org/subs', pageId: 2, category: 'c2' },
    { name: 'Jellyfin', url: 'http://localhost:8096/', pageId: 1, category: 'c1' },
    { name: 'Jellyfin admin', url: 'http://localhost:8096/web/admin', pageId: 1, category: 'c1' },
    { name: 'Media server', url: 'http://mediabox.lan:32400/web', pageId: 2, category: 'c2' },
];

async function open(page, hash = '#docker', bookmarks = BOOKMARKS) {
    const state = await mockDocker(page, { containers: CONTAINERS.map((c) => ({ ...c })) });
    await page.route((url) => url.pathname === '/api/bookmarks' && url.searchParams.get('all') === 'true',
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bookmarks) }));
    const saved = [];
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        saved.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto(`/${hash}`);
    await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible();
    return { state, saved };
}

test('each step of the match, and no guess between two', async ({ page }) => {
    await open(page);
    const got = await page.evaluate(({ bookmarks }) => {
        const index = window.DockerSearchIndex;
        const list = window.dashboardInstance.docker?.containers
            || Object.values(window.dashboardInstance).find((v) => v && Array.isArray(v.containers) && v.containers[0]?.shortId)?.containers;
        const of = (name, links = {}) => {
            const hit = index.bookmarkFor(list.find((c) => c.name === name), bookmarks, links);
            return hit ? `${hit.bookmark.name}/${hit.via}` : null;
        };
        return {
            sonarr: of('sonarr'), radarr: of('radarr'), bazarr: of('bazarr'), jellyfin: of('jellyfin'),
            plexByHand: of('plex', { plex: '2::http://mediabox.lan:32400/web' }),
            sonarrNone: of('sonarr', { sonarr: '-' }),
        };
    }, { bookmarks: BOOKMARKS });
    expect(got).toEqual({
        sonarr: 'Sonarr/port', radarr: 'Movies/subdomain', bazarr: 'Bazarr/title', jellyfin: null,
        plexByHand: 'Media server/manual', sonarrNone: null,
    });
});

test('the ring shows the bookmark health, and the side panel sets none', async ({ page }) => {
    const { saved } = await open(page);
    await expect(page.locator('[data-docker-row="sonarr"] [data-docker-bm-dot]')).toHaveAttribute('data-docker-bm-dot', 'good');
    await expect(page.locator('[data-docker-row="radarr"] [data-docker-bm-dot]')).toHaveAttribute('data-docker-bm-dot', 'off');
    await expect(page.locator('[data-docker-row="jellyfin"] [data-docker-bm-dot]')).toHaveCount(0);
    await expect(page.locator('[data-docker-row="sonarr"] [data-docker-bm-dot]')).toHaveAttribute('title', /Sonarr.*same port/);

    await page.locator('[data-docker-row="sonarr"] .docker-name').click();
    const drawer = page.locator('[data-docker-drawer]');
    await drawer.locator('[data-docker-section="bookmark"] summary').click();
    await expect(drawer.locator('[data-docker-bm-card]')).toContainText('Sonarr');
    await expect(drawer.locator('[data-docker-bm-state]')).toHaveAttribute('data-docker-bm-state', 'good');
    const picker = drawer.locator('[data-docker-bm-link]');
    await expect(picker.locator('option').first()).toHaveText('Automatic: Sonarr');
    // It fits the section, however long a bookmark's address is.
    const fits = await picker.evaluate((el) => el.getBoundingClientRect().right <= el.closest('[data-docker-section]').getBoundingClientRect().right + 1);
    expect(fits).toBe(true);
    await expect(picker.locator('option[value="1::http://localhost:8989/"]')).toHaveText('Sonarr · localhost:8989');
    await picker.selectOption('-');
    await expect.poll(() => saved.some((b) => b.dockerBookmarkLinks?.sonarr === '-')).toBe(true);
    await expect(page.locator('[data-docker-row="sonarr"] [data-docker-bm-dot]')).toHaveCount(0);
});

test('the bookmark sits after the link, so the addresses line up', async ({ page }) => {
    await open(page);
    const order = await page.locator('[data-docker-row="sonarr"] .docker-cell--webui').evaluate((td) =>
        [...td.children].map((el) => (el.hasAttribute('data-docker-bm-dot') ? 'bookmark' : 'link')));
    expect(order).toEqual(['link', 'bookmark']);
});

test('a bookmark says which container it runs in, with a link to it', async ({ page }) => {
    await open(page);
    const names = await page.evaluate(async (bookmark) => {
        const d = window.dashboardInstance;
        await d.config.load();
        await d.config.instance.ensureBookmarkRenderers();
        const root = document.createElement('div');
        root.innerHTML = '<div data-bm-containers hidden><span></span><span data-bm-containers-list></span></div>';
        document.body.appendChild(root);
        d.config.instance.fillBmDetailsContainers(root, bookmark);
        for (let i = 0; i < 50 && root.querySelector('[data-bm-containers]').hidden; i += 1) {
            await new Promise((r) => setTimeout(r, 50));
        }
        return [...root.querySelectorAll('[data-bm-container]')].map((a) => `${a.textContent} ${a.getAttribute('href')}`);
    }, BOOKMARKS[0]);
    expect(names).toEqual(['sonarr #docker/sonarr']);
});

// The mark opens the bookmark in the Bookmarks view: its row the cursor and in
// focus, its side panel open on Details.
test('a click on the mark opens the bookmark, its row in focus, on Details', async ({ page }) => {
    await open(page);
    await page.locator('[data-docker-row="sonarr"] [data-docker-bm-dot]').click();
    await expect(page).toHaveURL(/#bookmarks$/);
    const row = page.locator('#config-bm-list .config-bm-row[data-bm-key="1::http://localhost:8989/"]');
    await expect(row).toHaveClass(/keyboard-selected/);
    await expect(row).toBeFocused();
    await expect(page.locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-key', '1::http://localhost:8989/');
    await expect(page.locator('#config-bm-panel [data-bm-tab-panel="details"]')).toHaveAttribute('aria-selected', 'true');
});

// Further down than the first page of rows: the list is drawn down to it, and
// a later redraw (the categories landing) neither drops the cursor nor
// scrolls it away.
test('a bookmark far down the list still gets its row, in view and in focus', async ({ page }) => {
    const filler = Array.from({ length: 80 }, (_, i) => ({ name: `Aaa ${String(i).padStart(2, '0')}`, url: `https://filler-${i}.example.org/`, pageId: 1, category: 'c1' }));
    await open(page, '#docker', [...filler, { name: 'Zz Sonarr', url: 'http://localhost:8989/', pageId: 1, category: 'c1', checkStatus: true }]);
    await page.locator('[data-docker-row="sonarr"] [data-docker-bm-dot]').click();
    const row = page.locator('#config-bm-list .config-bm-row[data-bm-key="1::http://localhost:8989/"]');
    await expect(row).toBeFocused();
    await page.waitForTimeout(1500);
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
    await expect(page.locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-key', '1::http://localhost:8989/');
});
