// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * One letter used to fill the screen.
 *
 * In search mode every fuzzy result was rendered, flat, in score order and
 * nothing else. Typing "g" put `Gmail` and `widGetonderzoek` in the same
 * column, in the same style, with no way to tell why either was there — twenty
 * rows deep, most of them a letter buried mid-word.
 *
 * The score already knew the difference and the overlay already had group
 * headers with counts (the empty state and the inline filters use them). So the
 * results are grouped by *why* they matched: the strong matches stay open, the
 * weaker ones collapse to a header and a count, and the count is the promise
 * that nothing was thrown away.
 */

/** Seeds a known bookmark set into the search component and runs a query. */
async function searchWith(page, bookmarks, query, before = null) {
    return page.evaluate(({ bookmarks, query, before }) => {
        const s = window.dashboardInstance.searchComponent;
        s.interleaveMode = true;           // search mode: fuzzy by name
        s.emptyStateExpandedGroups.clear();
        s.fuzzySearchComponent.updateBookmarks(bookmarks);
        if (before) {
            s.currentQuery = before.query;
            s.updateSearch();
            (before.toggle || []).forEach((id) => s.toggleEmptyStateGroup(id));
        }
        s.currentQuery = query;
        s.updateSearch();
        return (s.searchMatches || []).map((m) => ({
            type: m.type,
            groupId: m.groupId || '',
            label: m.label || '',
            count: typeof m.count === 'number' ? m.count : null,
            expanded: m.expanded === true,
            name: m.name || m.bookmark?.name || '',
        }));
    }, { bookmarks, query, before });
}

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The set from the screenshot that started this: one letter, twenty rows. */
const G_SET = [
    { name: 'Gmail', url: 'https://mail.google.com' },
    { name: 'Google', url: 'https://google.com' },
    { name: 'Gemini', url: 'https://gemini.google.com' },
    { name: 'Github', url: 'https://github.com' },
    { name: 'MD5 Hash Generator', url: 'https://md5.example' },
    { name: 'komGa', url: 'https://komga.example' },
    { name: 'nGinx-pm', url: 'https://npm.example' },
    { name: 'instaGram', url: 'https://instagram.com' },
    { name: 'widGetonderzoek', url: 'https://widget.example' },
    { name: 'Untitled', url: 'https://a.example', tags: ['gaming'] },
];

const headers = (rows) => rows.filter((r) => r.type === 'command-group-header');
const byId = (rows, id) => headers(rows).find((h) => h.groupId === id);

test.beforeEach(async ({ page }) => { await openDashboard(page); });

test('one letter groups the results instead of listing all of them', async ({ page }) => {
    const rows = await searchWith(page, G_SET, 'g');

    const strong = byId(rows, 'search_strong');
    const contains = byId(rows, 'search_contains');
    const elsewhere = byId(rows, 'search_elsewhere');

    expect(strong, `no strong header in ${JSON.stringify(rows)}`).toBeTruthy();
    expect(contains).toBeTruthy();
    expect(elsewhere).toBeTruthy();

    // Gmail, Google, Gemini, Github, MD5 Hash *G*enerator
    expect(strong.count).toBe(5);
    // komGa, nGinx-pm, instaGram, widGetonderzoek
    expect(contains.count).toBe(4);
    // Untitled, by its #gaming tag
    expect(elsewhere.count).toBe(1);
});

test('only the strong group is open; the weaker ones are a header and a count', async ({ page }) => {
    const rows = await searchWith(page, G_SET, 'g');

    expect(byId(rows, 'search_strong').expanded).toBe(true);
    expect(byId(rows, 'search_contains').expanded).toBe(false);
    expect(byId(rows, 'search_elsewhere').expanded).toBe(false);

    const names = rows.filter((r) => r.type === 'fuzzy').map((r) => r.name);
    expect(names).toContain('Gmail');
    expect(names).not.toContain('widGetonderzoek');
});

test('a query with one kind of match renders flat, with no headers at all', async ({ page }) => {
    // The cure has to be quieter than the disease. Typing a full name should
    // not sprout a header over a single row.
    const rows = await searchWith(page, G_SET, 'gmail');

    expect(headers(rows)).toEqual([]);
    expect(rows.filter((r) => r.type === 'fuzzy').map((r) => r.name)).toEqual(['Gmail']);
});

test('when nothing matches strongly, the next group opens itself', async ({ page }) => {
    // Otherwise the overlay reports a header with a count and no rows — which
    // reads as "nothing found" while holding the answer behind a keystroke.
    // "am" matches no name strongly: instaGram carries it mid-word, and the
    // rest only through their .example domains.
    const rows = await searchWith(page, G_SET, 'am');

    expect(byId(rows, 'search_strong')).toBeFalsy();
    expect(byId(rows, 'search_contains').expanded).toBe(true);
    expect(rows.filter((r) => r.type === 'fuzzy').map((r) => r.name)).toContain('instaGram');
});

test('a single group needs no header, even when it is the weak one', async ({ page }) => {
    // "nx" reaches only nGinx-pm, and only mid-word. A lone header over a lone
    // row is the ceremony this change is supposed to remove.
    const rows = await searchWith(page, G_SET, 'nx');

    expect(headers(rows)).toEqual([]);
    expect(rows.filter((r) => r.type === 'fuzzy').map((r) => r.name)).toEqual(['nGinx-pm']);
});

test('a group you opened stays open while you keep typing', async ({ page }) => {
    // Re-collapsing on every keystroke would make the group unusable: you open
    // it, add a letter to narrow it, and it shuts in your face.
    const rows = await searchWith(page, G_SET, 'gi', {
        query: 'g',
        toggle: ['search_contains'],
    });

    expect(byId(rows, 'search_contains').expanded).toBe(true);
});

test('an open group stops at twelve rows and says how many are left', async ({ page }) => {
    const many = Array.from({ length: 15 }, (_, i) => ({
        name: `Alpha${String(i + 1).padStart(2, '0')}`,
        url: `https://a${i}.example`,
    }));
    const rows = await searchWith(page, many, 'alpha');

    expect(rows.filter((r) => r.type === 'fuzzy')).toHaveLength(12);
    const more = rows.find((r) => r.type === 'group-more');
    expect(more, `no overflow row in ${JSON.stringify(rows)}`).toBeTruthy();
    expect(more.count).toBe(3);
});

test('Enter opens the top bookmark rather than toggling the group above it', async ({ page }) => {
    // Group headers go into selectableMatches, and updateSearch parks the
    // selection on index 0. With a header there, the core flow — type, Enter —
    // would collapse a group instead of opening what you were aiming at.
    const selected = await page.evaluate((bookmarks) => {
        const s = window.dashboardInstance.searchComponent;
        s.interleaveMode = true;
        s.emptyStateExpandedGroups.clear();
        s.fuzzySearchComponent.updateBookmarks(bookmarks);
        s.currentQuery = 'g';
        s.updateSearch();
        const match = s.selectableMatches[s.selectedMatchIndex];
        return { type: match?.type, name: match?.name || match?.bookmark?.name || '' };
    }, G_SET);

    expect(selected.type).not.toBe('command-group-header');
    expect(selected.name).toBe('Gmail');
});
