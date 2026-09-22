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
        d._widgetUnsorted = null;
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: {} }, d);
        return body.textContent.replace(/\s+/g, ' ').trim();
    });

    expect(text).toContain('Newer kept');
    expect(text).toContain('Older kept');
    expect(text.indexOf('Newer kept')).toBeLessThan(text.indexOf('Older kept'));
});

/**
 * The widget held what /api/unsorted answered the first time it drew, for the
 * life of the tab, and nothing ever let that copy go: keep a link from the
 * inbox, come back to the dashboard, and the widget still showed the list from
 * before. Every bookmark mutation clears it now, so the next draw asks again.
 */
test('the widget picks up a bookmark kept after it first drew', async ({ page }) => {
    await openDashboard(page);

    const draw = () => page.evaluate(async () => {
        document.querySelectorAll('.unsorted-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget unsorted-probe';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        await window.DashboardWidgets.unsorted(body, { id: 'probe', type: 'unsorted', config: {} },
            window.dashboardInstance);
        return body.textContent.replace(/\s+/g, ' ').trim();
    });

    // Drawn once, so the widget is holding an answer.
    await draw();

    const name = `Kept after draw ${Date.now()}`;
    await page.evaluate(async (bookmarkName) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 999999,
                bookmark: { name: bookmarkName, url: `https://kept-after-draw-${Date.now()}.example`, category: '' },
            }),
        });
        // The repaint every add, edit, move and delete goes through.
        window.dashboardInstance.data.repaintBookmarkMutationSurfaces();
    }, name);

    await expect.poll(draw, { timeout: 10_000 }).toContain(name);
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
        d._widgetUnsorted = null;
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
