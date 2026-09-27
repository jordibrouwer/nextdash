// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('Unsorted widget lists kept bookmarks, most recent first', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Older kept', url: 'https://older-kept.example', category: '', createdAt: 1000 } }),
        });
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Newer kept', url: 'https://newer-kept.example', category: '', createdAt: 2000 } }),
        });
        await window.dashboardInstance.loadAllBookmarks();
    });

    const text = await page.evaluate(async () => {
        document.querySelectorAll('.unsorted-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unsorted-probe';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: {} }, d);
        return body.textContent.replace(/\s+/g, ' ').trim();
    });

    expect(text).toContain('Newer kept');
    expect(text).toContain('Older kept');
    expect(text.indexOf('Newer kept')).toBeLessThan(text.indexOf('Older kept'));
});

/**
 * The tile is Bookmarks → Unsorted in small: it reads the same list, so a link
 * promoted or deleted there is gone from it, and one kept is on it, as soon as
 * the bookmarks are loaded again -- which every write does.
 */
test('the widget follows the unsorted bookmarks, kept or taken away', async ({ page }) => {
    await openDashboard(page);

    const draw = () => page.evaluate(async () => {
        document.querySelectorAll('.unsorted-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unsorted-probe';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: { rows: 20 } },
            window.dashboardInstance);
        return body.textContent.replace(/\s+/g, ' ').trim();
    });

    await draw();
    const name = `Kept after draw ${Date.now()}`;
    const url = `https://kept-after-draw-${Date.now()}.example/`;
    await page.evaluate(async ({ n, u }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: n, url: u, category: '' } }),
        });
        await window.dashboardInstance.loadAllBookmarks();
    }, { n: name, u: url });
    await expect.poll(draw, { timeout: 10_000 }).toContain(name);

    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { url: u } }),
        });
        await window.dashboardInstance.loadAllBookmarks();
    }, url);
    await expect.poll(draw, { timeout: 10_000 }).not.toContain(name);
});

test('a row opens the Bookmarks view on Unsorted, with that bookmark in the side panel', async ({ page }) => {
    await openDashboard(page);
    const stamp = Date.now();
    const name = `Widget open ${stamp}`;
    await seedKept(page, [{ name, url: `https://widget-open-${stamp}.example/`, createdAt: Date.now() }]);
    await page.evaluate(async () => {
        document.querySelectorAll('.unsorted-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unsorted-probe';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: { rows: 20 } },
            window.dashboardInstance);
    });
    await page.locator('.unsorted-probe .dashboard-widget-row', { hasText: name }).click();

    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await expect(page).toHaveURL(/#bookmarks\?filter=unsorted$/);
    const panel = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.config-bm-panel-title')).toHaveText(name);
    await expect(panel.locator('[data-bm-panel-action="promote"]')).toBeVisible();
});

/*
 * The order is a setting, and the tile says which one it used.
 *
 * Five links out of forty look the same whichever rule chose them, so the
 * name of the rule is on screen — and the tag one has two meanings, one tag
 * filters and no tag groups.
 */
async function seedKept(page, rows) {
    await page.evaluate(async (bookmarks) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const bookmark of bookmarks) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { category: '', ...bookmark } }),
            });
        }
        await window.dashboardInstance.loadAllBookmarks();
    }, rows);
}

function drawWidget(page, config) {
    return page.evaluate(async (widgetConfig) => {
        document.querySelectorAll('.unsorted-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unsorted-probe';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: widgetConfig }, d);
        return {
            sort: body.querySelector('.dashboard-widget-kept-sort')?.textContent?.trim() || '',
            names: Array.from(body.querySelectorAll('.dashboard-widget-row-name')).map((n) => n.textContent.trim()),
            urls: Array.from(body.querySelectorAll('.dashboard-widget-row-url')).map((n) => n.textContent.trim()),
            groups: Array.from(body.querySelectorAll('.dashboard-widget-kept-group')).map((n) => n.textContent.trim()),
            hasShuffle: !!body.querySelector('.dashboard-widget-kept-shuffle'),
        };
    }, config);
}

test('the tile names the order it is showing, and only Random can shuffle', async ({ page }) => {
    await openDashboard(page);
    await seedKept(page, [{ name: 'Sort probe', url: 'https://sort-probe.example' }]);

    const recent = await drawWidget(page, {});
    expect(recent.sort).toBe('Most recent');
    expect(recent.hasShuffle).toBe(false);

    const random = await drawWidget(page, { sort: 'random' });
    expect(random.sort).toBe('Random');
    expect(random.hasShuffle).toBe(true);
});

test('each row carries its address under the name, shortened', async ({ page }) => {
    await openDashboard(page);
    const long = 'https://www.example-with-a-long-name.test/section/subsection/the-article-itself';
    await seedKept(page, [{ name: 'Row with an address', url: long }]);

    const drawn = await drawWidget(page, { rows: 20 });
    const url = drawn.urls[drawn.names.indexOf('Row with an address')];
    expect(url).toBeTruthy();
    // The scheme and www. are noise on every row, and the whole address would
    // push the tile wider than the dashboard gave it.
    expect(url).not.toContain('https://');
    expect(url).not.toContain('www.');
    expect(url.length).toBeLessThanOrEqual(44);
});

test('a tag shows only that tag, and no tag groups every tag under a heading', async ({ page }) => {
    await openDashboard(page);
    const stamp = Date.now();
    await seedKept(page, [
        { name: `Tagged red ${stamp}`, url: `https://tag-red-${stamp}.example`, tags: ['widgetred'] },
        { name: `Tagged blue ${stamp}`, url: `https://tag-blue-${stamp}.example`, tags: ['widgetblue'] },
    ]);

    const filtered = await drawWidget(page, { sort: 'tag', tag: ['widgetred'], rows: 20 });
    expect(filtered.sort).toBe('Tag: widgetred');
    expect(filtered.names).toContain(`Tagged red ${stamp}`);
    expect(filtered.names).not.toContain(`Tagged blue ${stamp}`);

    const byTag = await drawWidget(page, { sort: 'tag', rows: 20 });
    expect(byTag.sort).toBe('By tag');
    expect(byTag.groups).toContain('widgetred');
    expect(byTag.groups).toContain('widgetblue');
});
