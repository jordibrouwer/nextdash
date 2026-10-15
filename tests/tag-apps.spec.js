// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Self-hosted apps are known by what they are called, not where they live:
 * the host's first label, a whole word in the name or page title, and on a
 * private host the default port. The list ships with the catalogue
 * (internal/app/tag_apps.json), so these run against the one the server serves.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.TagSuggestions && !!window.TagCatalogue, null, { timeout: 15_000 });
}

/** The tags the engine offers each item, by key, with the served catalogue. */
async function offers(page, rows) {
    return page.evaluate(async (r) => {
        // The catalogue answers for the collection's hosts; these are asked
        // for as a draft's are, without going online.
        await window.TagCatalogue.ensureHosts(r.map((row) => row.url), { lookup: false, overlay: false });
        const catalogue = window.TagCatalogue.now();
        const out = {};
        window.TagSuggestions.suggest(r, { catalogue }).forEach((g) => g.keys.forEach((k) => {
            (out[k] = out[k] || []).push(g.tag);
        }));
        return out;
    }, rows.map(([key, url, name = '', title = '']) => ({ key, url, name, title, tags: [] })));
}

test('an app on the home network is known by its port, its label or its title', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        ['port', 'http://192.168.1.20:8989/'],
        ['label', 'https://radarr.home.lan/'],
        ['title', 'https://media.example.org/', '', 'Lidarr'],
        ['bare', 'http://homeassistant:8123/'],
    ]);
    expect(got.port).toEqual(expect.arrayContaining(['self-hosted', 'media-server']));
    expect(got.label).toEqual(expect.arrayContaining(['self-hosted', 'media-server']));
    expect(got.title).toEqual(expect.arrayContaining(['self-hosted', 'media-server']));
    expect(got.bare).toEqual(expect.arrayContaining(['self-hosted', 'smart-home']));
});

test('a public host is not an app for a borrowed label, an everyday word or a port', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        // `cloud` is a Nextcloud label at home, not on Google's cloud.
        ['cloud', 'https://cloud.google.com/'],
        // Flood is a torrent client and also a word.
        ['flood', 'https://flood.example.com/', 'Flood'],
        // Plex is a word inside "complex", not one on its own.
        ['complex', 'https://news.example.com/', 'A complex story'],
        // A port says nothing off the home network.
        ['port', 'https://public.example.com:8989/'],
    ]);
    expect(got.cloud || []).not.toContain('self-hosted');
    expect(got.flood || []).not.toContain('self-hosted');
    expect(got.complex || []).not.toContain('self-hosted');
    expect(got.port || []).not.toContain('self-hosted');
});

test('a port two apps share with different tags says nothing; one with the same tags does', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        // 9091: Transmission and Authelia.
        ['split', 'http://10.0.0.5:9091/'],
        // 5055: Overseerr and Jellyseerr, both media.
        ['shared', 'http://10.0.0.5:5055/'],
    ]);
    // Still a home address, so #self-hosted -- but neither app's subject.
    expect(got.split || []).not.toContain('torrent');
    expect(got.split || []).not.toContain('security');
    expect(got.shared).toEqual(expect.arrayContaining(['self-hosted', 'media-server']));
});

test('the long tail of apps is known at home, and only there', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        // Not in the hand list: from awesome-selfhosted and the catalogue's own sites.
        ['label', 'https://phpmyadmin.tail1234.ts.net/'],
        ['name', 'http://192.168.0.164:3590/', 'tracearr'],
        ['public', 'https://phpmyadmin.example.com/'],
    ]);
    expect(got.label).toEqual(expect.arrayContaining(['self-hosted', 'database']));
    expect(got.name).toEqual(expect.arrayContaining(['self-hosted', 'media-server']));
    expect(got.public || []).not.toContain('database');
});

test('at home a label is also a word in the name: adguard-1 on an IP is AdGuard', async ({ page }) => {
    await open(page);
    const got = await offers(page, [['ip', 'http://192.168.0.3/', 'adguard-1']]);
    expect(got.ip).toEqual(expect.arrayContaining(['self-hosted', 'networking']));
});

test('a domain two of your apps live under is a home address', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        ['jellyfin', 'https://jellyfin.example.cc/'],
        ['radarr', 'https://radarr.example.cc/'],
        ['other', 'https://tracearr.example.cc/'],
        ['alone', 'https://tracearr.example.org/'],
    ]);
    expect(got.other).toEqual(expect.arrayContaining(['self-hosted', 'media-server']));
    expect(got.alone || []).not.toContain('media-server');
});

test('whatever else sits at a home address is offered #self-hosted, a public site is not', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        ['ip', 'http://192.168.0.9/', 'delen'],
        ['tailnet', 'https://box.tail1234.ts.net/'],
        ['public', 'https://unknown-site-xyz.example/'],
    ]);
    expect(got.ip).toContain('self-hosted');
    expect(got.tailnet).toContain('self-hosted');
    expect(got.public || []).not.toContain('self-hosted');
});

test('AI sites get #ai from the catalogue', async ({ page }) => {
    await open(page);
    const got = await offers(page, [['claude', 'https://claude.ai/new'], ['chatgpt', 'https://chatgpt.com/']]);
    expect(got.claude).toContain('ai');
    expect(got.chatgpt).toContain('ai');
});

test('the Bookmarks view offers #self-hosted on a Sonarr bookmark, and says why', async ({ page }) => {
    const N = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const name = `Sonarr ${N}`;
    await page.evaluate(async (n) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, allowDuplicate: true, bookmark: { category: '', name: n, url: `http://192.168.1.20:8989/?k=${n}`, tags: [], createdAt: Date.now() } }),
        });
        await d.loadAllBookmarks?.();
        window.TagSuggestLive.changed(d);
        await d.config.openLibraryView();
    }, name);
    await page.locator('#config-bm-search').fill(N);
    const row = page.locator('#config-bm-list .config-bm-row', { hasText: name }).first();
    const offer = row.locator('.tag-offer[data-bm-offer="self-hosted"]');
    await expect(offer).toBeVisible({ timeout: 10_000 });
    await expect(offer).toHaveAttribute('title', 'Recognised as Sonarr');
});

test('a YouTube channel gets its own subject, the rest of YouTube the site\'s', async ({ page }) => {
    await open(page);
    const got = await offers(page, [
        ['channel', 'https://www.youtube.com/@veritasium/videos'],
        ['video', 'https://www.youtube.com/watch?v=abc'],
        ['tech', 'https://www.theverge.com/2026/10/14/review'],
    ]);
    expect(got.channel).toContain('science');
    expect(got.channel || []).not.toContain('video');
    expect(got.video).toContain('video');
    expect(got.tech).toContain('tech-news');
});
