// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * "Nothing found" is only true when nothing was found.
 *
 * With *Switch Search Mode* off — the default — typing letters looks for a
 * bookmark shortcut. Type a bookmark's name and there is usually no shortcut by
 * that name, so the overlay reports nothing, while the bookmark it describes is
 * sitting on the page. The search knew: it simply looked in one of its two
 * places.
 *
 * So when the shortcut search comes back empty and a name search would not, the
 * overlay says so, and names the key that gets there.
 */
async function typeInSearch(page, query) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // A rendered bookmark is not the same promise as a built search component:
    // on a loaded runner the evaluate below reached a null dashboardInstance.
    await page.waitForFunction(
        () => window.dashboardInstance?.searchComponent != null, null, { timeout: 20_000 });
    return page.evaluate((q) => {
        const s = window.dashboardInstance.searchComponent;
        s.interleaveMode = false;          // shortcut-first, the default
        s.currentQuery = q;
        s.updateSearch();
        return (s.searchMatches || []).map((m) => ({
            type: m.type,
            label: m.label || '',
            name: m.bookmark?.name || '',
        }));
    }, query);
}

test('a name that matches no shortcut offers the way to find it', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    const name = await page.evaluate(() => {
        const b = (window.dashboardInstance?.bookmarks || []).find((x) => (x.name || '').length > 5);
        return b ? b.name : null;
    });
    expect(name, 'no bookmark with a long enough name').toBeTruthy();

    const matches = await typeInSearch(page, name);
    const hint = matches.find((m) => m.type === 'mode-hint');
    expect(hint, `typing "${name}" gave no hint, only ${JSON.stringify(matches)}`).toBeTruthy();
    // It has to name the key, or it is just a nicer way of saying nothing.
    expect(hint.label).toContain('/');
    expect(hint.label).toContain(name);
});

test('a query nothing matches gets no hint', async ({ page }) => {
    // The hint is a statement of fact — there IS a name match. Without one,
    // "nothing found" is the honest answer and an extra row is noise.
    const matches = await typeInSearch(page, 'zzzqqxnothingmatchesthis');
    expect(matches.find((m) => m.type === 'mode-hint')).toBeFalsy();
});

test('a query that does match a shortcut gets no hint', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    const shortcut = await page.evaluate(() => {
        const b = (window.dashboardInstance?.bookmarks || []).find((x) => (x.shortcut || '').trim());
        return b ? b.shortcut : null;
    });
    test.skip(!shortcut, 'no bookmark carries a shortcut in this fixture');

    const matches = await typeInSearch(page, shortcut);
    expect(matches.find((m) => m.type === 'mode-hint'),
        'the shortcut search worked, so there is nothing to explain').toBeFalsy();
});

/*
 * The hint names a key, so that key has to work.
 *
 * The `/` handler returned early whenever *Switch Search Mode* was off -- the
 * default, and the only state in which this hint is ever shown. So the overlay
 * told the reader to press `/`, and then dropped it: the query did not change,
 * nothing switched, and the bookmark it had just promised stayed out of reach.
 * The setting's own help says `/` works in both states and only its meaning
 * flips, which is what this checks.
 */
async function openSearchAndType(page, { interleaveMode }) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (m) => {
        // Built from a lazily fetched bundle, so it can still be null here.
        await window.SearchLoader?.ensureReady?.();
        window.dashboardInstance.searchComponent.interleaveMode = m;
    }, interleaveMode);
    await page.keyboard.press('>');
    await expect
        .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
            { timeout: 15_000 })
        .toBe(true);
    await page.keyboard.type('abc');
    return page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);
}

test('/ switches the mode with Switch Search Mode off', async ({ page }) => {
    const before = await openSearchAndType(page, { interleaveMode: false });
    expect(before).toBe('abc');

    await page.keyboard.press('/');
    const after = await page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);

    // In front, not appended: the prefix is read from the first character, and
    // the hint's own Enter action builds the same `/${query}`. A trailing slash
    // would land in the box and switch nothing.
    expect(after).toBe('/abc');
});

test('/ switches the mode with Switch Search Mode on', async ({ page }) => {
    const before = await openSearchAndType(page, { interleaveMode: true });
    expect(before).toBe('abc');

    await page.keyboard.press('/');
    const after = await page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);

    expect(after).toBe('/abc');
});

/*
 * `/` on an empty box enters tag mode now.
 *
 * It used to type the character, because at the time `/` meant nothing there.
 * When tags moved into the search panel it became that mode's prefix
 * (SearchComponent.MODE_ENTRY), and a bare `/` sitting in an empty box was
 * never useful. The mode switch itself is untouched: with something typed, `/`
 * still leads the query, which is what the hint's Enter action builds.
 */
test('pressing / on an empty search enters tag mode', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        // Built from a lazily fetched bundle, so it can still be null here.
        await window.SearchLoader?.ensureReady?.();
        window.dashboardInstance.searchComponent.interleaveMode = false;
    });
    await page.keyboard.press('>');
    await expect
        .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
            { timeout: 15_000 })
        .toBe(true);

    await page.keyboard.press('/');
    const after = await page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);
    expect(after).toBe('tag:');

    // And with something typed, the key still leads the query rather than
    // replacing it — the mode switch the hint points at.
    await page.evaluate(() => {
        const sc = window.dashboardInstance.searchComponent;
        sc.currentQuery = 'read';
        sc.updateSearch();
    });
    await page.keyboard.press('/');
    expect(await page.evaluate(
        () => window.dashboardInstance.searchComponent.currentQuery)).toBe('/read');
});
