// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One question, one list -- with a rail that says what else there is.
 *
 * The panel answered one kind at a time. A reader who did not already know
 * that "inbox" is a command as well as a bookmark, or that a finder can take
 * the word straight to another site, had to type a prefix to find out; and the
 * prefixes were advertised by a row of pills under the results, at the far end
 * of the sheet from the line that sets them.
 *
 * A plain word now asks every kind at once and the answers are stacked under
 * their own heading, each kind capped. The rail beside the list names every
 * kind with the key that scopes to it and how many of that kind the query
 * answers, and Tab walks it -- the scope had no key of its own before.
 */

async function openSearch(page, query = '') {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Through the key someone presses, not through the renderer.
    await page.keyboard.press('>');
    await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
    for (const ch of query) {
        await page.keyboard.press(ch);
        await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
}

/** A bookmark, a command and a finder that one word all answers. */
async function seedWord(page, word) {
    await page.evaluate(async (term) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const existing = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...existing, {
                name: `${term} spec bookmark`,
                url: `https://example.com/${term}-spec`,
                shortcut: '',
                category: '',
                checkStatus: false,
            }]),
        });
        await dash.loadData();
    }, word);
}

const listShape = (page) => page.evaluate(() => ({
    heads: [...document.querySelectorAll('.search-scope-section')]
        .map((el) => el.querySelector('.search-scope-section-label')?.textContent?.trim()),
    counts: [...document.querySelectorAll('.search-scope-section')]
        .map((el) => Number(el.querySelector('.search-scope-section-count')?.textContent || 0)),
    commands: [...document.querySelectorAll('.search-match.command-entry, .search-match')]
        .filter((el) => (el.querySelector('.search-match-shortcut')?.textContent || '').startsWith(':')).length,
    rail: [...document.querySelectorAll('.search-scope')].map((el) => ({
        mode: el.dataset.mode,
        label: el.querySelector('.search-mode-tab-label')?.textContent?.trim(),
        count: el.querySelector('.search-scope-count')?.textContent?.trim() || '',
        active: el.classList.contains('active'),
        dimmed: el.classList.contains('is-empty'),
    })),
}));

test('a plain word answers with every kind at once', async ({ page }) => {
    await openSearch(page);
    await seedWord(page, 'theme');
    // Retype now that the store has the bookmark in it.
    await page.keyboard.press('Escape');
    await openSearch(page, 'theme');

    const shape = await listShape(page);

    expect(shape.heads, 'the kinds are not stacked under their own headings')
        .toEqual(expect.arrayContaining(['bookmarks', 'commands']));
    expect(shape.commands, 'no command answered a plain word').toBeGreaterThan(0);
    // Every heading counts what is under it.
    expect(shape.counts.every((n) => n > 0), 'a heading counts nothing').toBe(true);
});

test('the rail says what each kind answers, and dims the kinds that answer nothing', async ({ page }) => {
    await openSearch(page, 'theme');

    const shape = await listShape(page);
    const by = (mode) => shape.rail.find((r) => r.mode === mode);

    expect(shape.rail.length, 'the rail lost a rung').toBe(6);
    expect(by('search')?.active, 'the rail does not say which scope is in force').toBe(true);
    expect(by('search')?.count, 'the rail counts nothing at all').not.toBe('');
    expect(Number(by('command')?.count || 0), 'the rail does not count the commands').toBeGreaterThan(0);
    // A kind with no answer stays on the rail, dimmed: a rail that changes
    // length while you type is a rail you cannot aim at.
    expect(by('tag')?.dimmed, 'an empty kind was removed instead of dimmed').toBe(true);
});

test('tab walks the rail and keeps the word', async ({ page }) => {
    await openSearch(page, 'theme');

    const state = () => page.evaluate(() => ({
        query: window.dashboardInstance.searchComponent.currentQuery,
        scope: window.dashboardInstance.searchComponent.currentScope(),
    }));

    expect(await state(), 'a plain word does not start in everything')
        .toMatchObject({ scope: 'all', query: 'theme' });

    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    // Scoping narrows the question rather than asking a new one.
    expect(await state(), 'tab did not walk to the commands')
        .toMatchObject({ scope: 'commands', query: ':theme' });

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(300);
    expect((await state()).scope, 'shift+tab did not walk back').toBe('all');
});

test('the commands scope opens on its headings, closed', async ({ page }) => {
    await openSearch(page);
    await page.keyboard.press(':');
    await page.waitForTimeout(400);

    const rows = await page.evaluate(() => ({
        headers: document.querySelectorAll('.search-command-group-header').length,
        open: [...document.querySelectorAll('.search-command-group-arrow')]
            .filter((el) => el.textContent.trim() === '▾').length,
        commands: [...document.querySelectorAll('.search-match')]
            .filter((el) => (el.querySelector('.search-match-shortcut')?.textContent || '').startsWith(':')).length,
    }));

    expect(rows.headers, 'the groups are gone entirely').toBeGreaterThan(0);
    // Sixty commands unfolded before anything was asked for is a list to
    // scroll, not a menu to read: the headings say what is behind them and
    // opening one is a keystroke.
    expect(rows.open, 'a group was open before it was asked for').toBe(0);
    expect(rows.commands, 'the commands are on screen unasked').toBe(0);
});

test('! opens the cheat sheet from inside the panel', async ({ page }) => {
    await openSearch(page);
    await page.keyboard.press('!');
    await page.waitForTimeout(600);

    const sheet = await page.evaluate(() => ({
        open: !!document.querySelector('.cheat-sheet-group'),
        // The key is advertised on the rail, so it has to work where it is read.
        onRail: !!document.querySelector('.search-scope[data-mode="keys"]'),
        typed: window.dashboardInstance.searchComponent.currentQuery,
    }));

    expect(sheet.onRail, 'the rail does not name the cheat sheet').toBe(true);
    expect(sheet.open, 'the cheat sheet did not open').toBe(true);
    expect(sheet.typed, 'the key was typed into the query instead').not.toContain('!');
});
