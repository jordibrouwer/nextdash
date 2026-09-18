// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Recents: the last four as tiles, the rest as rows.
 *
 * The mode drew twenty identical lines. Nine times in ten what is wanted is
 * one of the last few, and a line of text among twenty identical lines is a
 * poor target for that -- so the four newest get a box with the time they were
 * opened, and everything older stays a row.
 *
 * Two things were wrong with the rows themselves, whatever sits above them.
 * The shortcut was a flex child that simply was not there on a bookmark
 * without one, so the icon and the name of those rows started somewhere else
 * than the rows around them. And nothing said when: twenty names in a row with
 * no way to tell the one from five minutes ago from the one from last week.
 */

/** Bookmarks opened at known times, half of them without a shortcut. */
async function seedRecent(page, count) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const base = Date.now();
        const additions = Array.from({ length: n }, (_, index) => ({
            name: `Recent tile ${index + 1}`,
            url: `https://example.com/recent-tile-${base}-${index}`,
            // Every other one has no key: that is the row that used to slide.
            shortcut: index % 2 === 0 ? `RT${index}` : '',
            category: '',
            checkStatus: false,
            // One an hour apart, so each row has a different answer to "when".
            lastOpened: base - index * 3600 * 1000,
            openCount: 2,
            createdAt: base - index * 3600 * 1000,
        }));
        const existing = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...existing, ...additions]),
        });
        await dash.loadData();
    }, count);
}

async function openRecents(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await seedRecent(page, 10);

    /*
     * The tile band is the search panel's recents mode, not the header sheet.
     * `*` on the grid opens the sheet — a different surface with its own rows,
     * its own tests and no band — so pressing it here waited for a tile that
     * was never coming. Inside the panel, `*` is the prefix that mode is
     * registered under (search.js), and openInRecentMode() is the entry point
     * the panel itself uses for it.
     */
    await page.evaluate(() => window.dashboardInstance.searchComponent.openInRecentMode());
    await page.waitForSelector('.search-recent-tile', { timeout: 20_000 });
}

test('the four newest are tiles and the rest are rows', async ({ page }) => {
    await openRecents(page);

    const shape = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('.search-recent-tile')];
        const rows = [...document.querySelectorAll('.search-match--recent')];
        return {
            tiles: tiles.length,
            rows: rows.length,
            // The tiles are one band, so they share a top.
            oneBand: new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size,
            // And the rows are under them.
            below: rows.length
                ? rows[0].getBoundingClientRect().top > tiles[0].getBoundingClientRect().bottom
                : false,
            firstTileName: tiles[0]?.querySelector('.search-recent-tile-name')?.textContent?.trim(),
            firstTileWhen: tiles[0]?.querySelector('.search-recent-tile-when')?.textContent?.trim(),
        };
    });

    expect(shape.tiles, 'the band does not hold four').toBe(4);
    expect(shape.rows, 'everything older than the fourth is a tile too').toBeGreaterThan(0);
    expect(shape.oneBand, 'the tiles wrapped onto more than one line').toBe(1);
    expect(shape.below, 'the list does not sit under the tiles').toBe(true);
    expect(shape.firstTileName, 'the newest is not the first tile').toBe('Recent tile 1');
    expect(shape.firstTileWhen, 'a tile does not say when it was opened').toBeTruthy();
});

test('a row without a shortcut starts in the same column as one with', async ({ page }) => {
    await openRecents(page);

    const columns = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.search-match--recent')];
        const read = (row) => {
            const icon = row.querySelector('.search-match-favicon-slot');
            const name = row.querySelector('.search-match-name');
            return {
                hasKey: (row.querySelector('.search-match-shortcut')?.textContent || '').trim().length > 0,
                icon: icon ? Math.round(icon.getBoundingClientRect().x) : null,
                name: Math.round(name.getBoundingClientRect().x),
                when: (row.querySelector('.search-match-when')?.textContent || '').trim(),
            };
        };
        const all = rows.map(read);
        return {
            withKey: all.filter((r) => r.hasKey),
            without: all.filter((r) => !r.hasKey),
            names: new Set(all.map((r) => r.name)).size,
            whens: all.map((r) => r.when),
        };
    });

    expect(columns.withKey.length, 'no row in the list carries a key').toBeGreaterThan(0);
    expect(columns.without.length, 'every row in the list carries a key').toBeGreaterThan(0);
    expect(columns.names, 'the names start in more than one column').toBe(1);
    expect(columns.whens.every((w) => w.length > 0), 'a row does not say when it was opened').toBe(true);
});

test('the keys walk the band across and the list down', async ({ page }) => {
    await openRecents(page);

    const selected = () => page.evaluate(() => {
        const el = document.querySelector('.keyboard-selected');
        return {
            tile: !!el?.classList.contains('search-recent-tile'),
            index: window.dashboardInstance.searchComponent.selectedMatchIndex,
            name: (el?.querySelector('.search-recent-tile-name') || el?.querySelector('.search-match-name'))
                ?.textContent?.trim(),
        };
    });

    // It opens on the newest.
    expect((await selected()).index, 'the panel does not open on the newest').toBe(0);

    await page.keyboard.press('ArrowRight');
    expect(await selected(), 'right does not walk the band').toMatchObject({ tile: true, index: 1 });

    await page.keyboard.press('ArrowLeft');
    expect((await selected()).index, 'left does not walk the band back').toBe(0);

    // Down out of a tile is down, not "the tile beside it".
    await page.keyboard.press('ArrowDown');
    const first = await selected();
    expect(first.tile, 'down from a tile stayed in the band').toBe(false);
    expect(first.index, 'down from a tile skipped past the list').toBe(4);

    await page.keyboard.press('ArrowUp');
    expect(await selected(), 'up from the list did not return to the band')
        .toMatchObject({ tile: true, index: 0 });
});

test('a row names its page only when it is not the page you are on', async ({ page }) => {
    await openRecents(page);

    const meta = await page.evaluate(() => {
        const component = window.dashboardInstance.searchComponent;
        const matches = component._recentModeMatches();
        const here = matches.filter((m) => m.bookmark.pageId === window.dashboardInstance.currentPageId);
        return {
            here: here.length,
            named: here.filter((m) => m.meta).length,
            // What the same bookmark reports when the reader stands elsewhere.
            elsewhere: (() => {
                const dash = window.dashboardInstance;
                const mine = dash.currentPageId;
                const other = dash.pages.find((p) => !dash.samePageId(p.id, mine));
                if (!other) return 'no second page';
                const saved = dash.currentPageId;
                dash.currentPageId = other.id;
                const value = component._recentPageMeta(here[0].bookmark);
                dash.currentPageId = saved;
                return value;
            })(),
        };
    });

    expect(meta.here, 'nothing recent is on this page').toBeGreaterThan(0);
    expect(meta.named, 'the rows name the page you are already on').toBe(0);
    expect(meta.elsewhere, 'a bookmark on another page does not name it').toBeTruthy();
});
