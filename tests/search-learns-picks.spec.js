// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The search remembers which result these keystrokes meant.
 *
 * `openCount` and `lastOpened` have been on every bookmark all along, and the
 * ranking read neither — so the list looked the same on your thousandth search
 * as on your first. Worse, the one thing that would settle it was thrown away
 * at the moment it appeared: the history kept what you typed and never what
 * you then chose.
 *
 * So a pick is written down against the exact query that produced it, and the
 * scorer is told. Three picks turn "mail" into your own alias for Gmail
 * without you creating a shortcut for it.
 *
 * It lives in settings the way saved searches do, which is what carries it
 * into the backup and across to a second browser, with localStorage kept in
 * step so an older tab still sees it.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Records a pick the way opening a bookmark from search does. */
async function recordPick(page, query, bookmark) {
    return page.evaluate(({ query, bookmark }) => {
        const s = window.dashboardInstance.searchComponent;
        s.currentQuery = query;
        s.recordSearchPick(bookmark);
        return s.searchPicks;
    }, { query, bookmark });
}

const GMAIL = { name: 'Gmail', url: 'https://mail.example' };

test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.searchPicks = [];
    });
});

test('opening a result writes down the query it came from', async ({ page }) => {
    const picks = await recordPick(page, 'mail', GMAIL);

    expect(picks).toHaveLength(1);
    expect(picks[0].q).toBe('mail');
    expect(picks[0].url).toBe('https://mail.example');
    expect(picks[0].n).toBe(1);
    expect(picks[0].at).toBeGreaterThan(0);
});

test('picking the same thing again counts, it does not duplicate', async ({ page }) => {
    await recordPick(page, 'mail', GMAIL);
    await recordPick(page, 'mail', GMAIL);
    const picks = await recordPick(page, 'mail', GMAIL);

    expect(picks).toHaveLength(1);
    expect(picks[0].n).toBe(3);
});

test('the same bookmark under different keystrokes is a different memory', async ({ page }) => {
    await recordPick(page, 'mail', GMAIL);
    const picks = await recordPick(page, 'gm', GMAIL);

    expect(picks).toHaveLength(2);
    expect(picks.map((p) => p.q).sort()).toEqual(['gm', 'mail']);
});

test('the query is remembered as typed, without its filters or mode prefix', async ({ page }) => {
    // "/mail tag:work" is the same intent as "mail" — the prefix chooses a
    // mode and the token is a filter. Storing them whole would mean the memory
    // never matched anything you typed a second time.
    const picks = await recordPick(page, '/mail tag:work', GMAIL);

    expect(picks[0].q).toBe('mail');
});

test('nothing is written for an empty query', async ({ page }) => {
    const picks = await recordPick(page, '   ', GMAIL);
    expect(picks).toEqual([]);
});

test('the memory reaches the scorer, so the next search is ranked by it', async ({ page }) => {
    const order = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.interleaveMode = true;
        s.emptyStateExpandedGroups.clear();
        s.fuzzySearchComponent.updateBookmarks([
            { name: 'Mailcow', url: 'https://mailcow.example' },
            { name: 'Gmail', url: 'https://mail.example' },
        ]);

        const before = (() => {
            s.currentQuery = 'mail';
            s.updateSearch();
            return s.searchMatches.filter((m) => m.bookmark).map((m) => m.bookmark.name);
        })();

        s.searchPicks = [];
        for (let i = 0; i < 4; i++) {
            s.currentQuery = 'mail';
            s.recordSearchPick({ name: 'Gmail', url: 'https://mail.example' });
        }

        s.currentQuery = 'mail';
        s.updateSearch();
        const after = s.searchMatches.filter((m) => m.bookmark).map((m) => m.bookmark.name);
        return { before, after };
    });

    // The shape of the words says Mailcow; four presses of Enter say otherwise.
    expect(order.before[0]).toBe('Mailcow');
    expect(order.after[0]).toBe('Gmail');
});

test('picks land in settings, which the backup carries', async ({ page }) => {
    await recordPick(page, 'mail', GMAIL);

    const stored = await page.evaluate(() => ({
        settings: window.dashboardInstance.settings.searchPicks,
        local: JSON.parse(localStorage.getItem('dashboardSearchPicks') || 'null'),
    }));

    expect(stored.settings).toHaveLength(1);
    expect(stored.settings[0].q).toBe('mail');
    // Kept in step so an older tab still sees them, the way saved searches are.
    expect(stored.local).toHaveLength(1);
});

test('the memory survives a reload, because the server kept it', async ({ page }) => {
    // The settings copy is the one that travels — into the backup, and to a
    // second browser. A field the server quietly drops would leave the feature
    // working all session and forgetting everything overnight.
    await recordPick(page, 'mail', GMAIL);
    await page.waitForTimeout(2500); // the settings write is debounced

    await page.evaluate(() => localStorage.removeItem('dashboardSearchPicks'));
    await openDashboard(page);

    const picks = await page.evaluate(() => window.dashboardInstance.searchComponent.searchPicks);
    expect(picks).toHaveLength(1);
    expect(picks[0].q).toBe('mail');
    expect(picks[0].n).toBe(1);
});

test('the memory cannot grow without bound', async ({ page }) => {
    const picks = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.searchPicks = [];
        for (let i = 0; i < 260; i++) {
            s.currentQuery = `q${i}`;
            s.recordSearchPick({ name: `B${i}`, url: `https://b${i}.example` });
        }
        return s.searchPicks;
    });

    expect(picks.length).toBeLessThanOrEqual(200);
});

test('when it is full, the weakest memory is the one dropped', async ({ page }) => {
    const kept = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.searchPicks = [];
        // One query you lean on, then a flood of one-offs.
        for (let i = 0; i < 9; i++) {
            s.currentQuery = 'favourite';
            s.recordSearchPick({ name: 'Gmail', url: 'https://mail.example' });
        }
        for (let i = 0; i < 260; i++) {
            s.currentQuery = `q${i}`;
            s.recordSearchPick({ name: `B${i}`, url: `https://b${i}.example` });
        }
        return s.searchPicks.some((p) => p.q === 'favourite');
    });

    expect(kept).toBe(true);
});
