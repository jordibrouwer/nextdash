// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Search keeps what the reader meant: a command's list is not a typed search,
 * a name search is saved with its `/`, a late refresh keeps the selection, a
 * quoted tag stays one filter, and :find survives a render.
 */
async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.searchComponent, null, { timeout: 20_000 });
}

async function openSearch(page) {
    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.()))).toBe(true);
}

test('opening a bookmark from a command list teaches the ranking nothing', async ({ page }) => {
    await open(page);
    const picks = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.saveSearchPicks = () => {};
        const before = s.searchPicks.length;
        for (const q of [':tag work', ':stale 30', '*']) {
            s.currentQuery = q;
            s.recordSearchPick({ url: 'https://probe-pick.example.test' });
        }
        return s.searchPicks.length - before;
    });
    expect(picks).toBe(0);
});

test('Ctrl/Cmd+Enter on a name-search result opens a new tab', async ({ page }) => {
    await open(page);
    const name = await page.evaluate(() => window.dashboardInstance.bookmarks.find((b) => b.name && b.name.length > 3)?.name);
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        window.__opened = [];
        s.openBookmark = (bookmark, opts) => { window.__opened.push({ url: bookmark?.url, newTab: Boolean(opts?.newTab) }); s.closeSearch(); };
    });
    await openSearch(page);
    // `/` on an empty query opens tag:, so the name search is set as typed.
    await page.evaluate((q) => {
        const s = window.dashboardInstance.searchComponent;
        s.currentQuery = q;
        s.updateSearch();
    }, `/${String(name).slice(0, 4)}`);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.selectableMatches
        .some((m) => m.type === 'fuzzy'))).toBe(true);
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.selectedMatchIndex = s.selectableMatches.findIndex((m) => m.type === 'fuzzy');
    });
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([expect.objectContaining({ newTab: true })]);
});

test(':save keeps the / of a name search', async ({ page }) => {
    await open(page);
    await openSearch(page);
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.currentQuery = '/mail';
        s.updateSearch();
    });
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.lastNonCommandQuery)).toBe('/mail');
});

test('container names arriving late keep the selected row', async ({ page }) => {
    await open(page);
    await openSearch(page);
    const kept = await page.evaluate(async () => {
        const s = window.dashboardInstance.searchComponent;
        let release;
        const arrived = new Promise((r) => { release = r; });
        window.DockerSearchIndex = {
            containers: () => [],
            refresh: () => arrived,
            match: () => [],
        };
        s.currentQuery = '/e';
        s.updateSearch();
        if (s.selectableMatches.length < 3) return `too few rows: ${s.selectableMatches.length} active=${s.searchActive}`;
        s.selectedMatchIndex = 2;
        const picked = s.selectableMatches[2];
        s._refreshDockerIndex();
        release([{ name: 'late' }]);
        await new Promise((r) => setTimeout(r, 50));
        const now = s.selectableMatches[s.selectedMatchIndex];
        return now === picked || (Boolean(picked.bookmark) && now?.bookmark === picked.bookmark);
    });
    expect(kept).toBe(true);
});

test('a quoted tag with a space is one filter, and its completion quotes it', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        const parsed = s.parseSearchFilters('tag:"Home Lab" grafana');
        return { tag: parsed.filters.tag, query: parsed.query, completion: s.constructor.tagFilter('home lab') };
    });
    expect(out).toEqual({ tag: 'home lab', query: 'grafana', completion: 'tag:"home lab"' });
});

test('row lookups skip a smart collection\'s copy of the bookmark', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const real = document.querySelector('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url]');
        const copy = document.createElement('div');
        copy.className = 'category';
        copy.setAttribute('data-smart-collection', 'true');
        const row = real.cloneNode(true);
        row.setAttribute('data-probe-copy', '1');
        copy.appendChild(row);
        const layout = document.getElementById('dashboard-layout');
        layout.prepend(copy);
        try {
            const url = real.getAttribute('data-bookmark-url');
            const index = Number(real.getAttribute('data-bookmark-index'));
            const byIndex = d.findBookmarkRowForDeepLink({ bookmarkIndex: index });
            const byUrl = d.findBookmarkRowForDeepLink({ url });
            const cmds = d.searchComponent.commandsComponent;
            const was = cmds.contextBookmark;
            cmds.contextBookmark = { url, name: '' };
            const target = cmds._resolveBookmarkActionTarget();
            cmds.contextBookmark = was;
            return [byIndex, byUrl, target?.row].map((r) => Boolean(r) && !r.hasAttribute('data-probe-copy'));
        } finally {
            copy.remove();
        }
    });
    expect(out).toEqual([true, true, true]);
});

test(':find stays on after the grid renders again', async ({ page }) => {
    await open(page);
    const hidden = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const name = document.querySelector('#dashboard-layout .bookmark-link .bookmark-text')?.textContent || '';
        document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query: name.trim().slice(0, 4) } }));
        d.renderDashboard({ incremental: false });
        const count = document.querySelectorAll('#dashboard-layout .bookmark-link.find-hidden').length;
        document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query: '' } }));
        return count;
    });
    expect(hidden).toBeGreaterThan(0);
});
