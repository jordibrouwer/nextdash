// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Waiting on a bookmark is said out loud.
 *
 * Opening in the same tab leaves nextDash on screen until the other end
 * answers, and nothing said so: the row looked exactly as it had a moment
 * before, so a slow host read as a key that had not worked. The row wears a
 * spinner and the word, and a 2px line under the header band says the same for
 * a row that is scrolled away or a shortcut pressed from another view.
 *
 * Nothing is drawn for the first 150ms: a bookmark that opens at once must not
 * flicker.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    /*
     * Nothing may actually leave the page.
     *
     * The open is a real anchor click -- a row's own link, or the hidden one
     * search builds -- and letting it through navigates the test away from the
     * thing it is measuring. Both are stopped before any handler of ours runs,
     * so the code under test sees exactly the click it would in a browser.
     */
    await page.addInitScript(() => {
        document.addEventListener('click', (e) => {
            const link = e.target?.closest?.('a');
            if (link && link.href && !link.href.startsWith('javascript:')) e.preventDefault();
        }, true);
        const nativeClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function stubbed() {
            if (this.href) {
                window.__openedHrefs = window.__openedHrefs || [];
                window.__openedHrefs.push(this.href);
                return undefined;
            }
            return nativeClick.apply(this, arguments);
        };
    });
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        // Same tab: that is the wait this exists for. A new tab leaves this one
        // on screen and gets a pulse instead -- covered below.
        const d = window.dashboardInstance;
        d.settings.openInNewTab = false;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.renderDashboard?.({ animate: false });
    });
    await page.waitForTimeout(300);
}

const marks = (page) => page.evaluate(() => ({
    rows: document.querySelectorAll('.bookmark-link.is-opening').length,
    note: document.querySelector('.bookmark-opening-note')?.textContent?.trim() || null,
    bar: Boolean(document.getElementById('bookmark-open-progress')),
}));

test('a click marks the row and the band, but not at once', async ({ page }) => {
    await openDashboard(page);

    await page.locator('.bookmark-link a.bookmark-open').first().click();

    // Inside the delay there is nothing to see.
    expect(await marks(page), 'the mark was drawn before the delay was up')
        .toEqual({ rows: 0, note: null, bar: false });

    await expect.poll(() => marks(page), { timeout: 5_000 }).toEqual({
        rows: 1,
        note: expect.any(String),
        bar: true,
    });

    const seen = await marks(page);
    expect(seen.note.length, 'the row says nothing').toBeGreaterThan(0);
});

test('coming back to the tab takes the mark off again', async ({ page }) => {
    await openDashboard(page);
    await page.locator('.bookmark-link a.bookmark-open').first().click();
    await expect.poll(async () => (await marks(page)).bar, { timeout: 5_000 }).toBe(true);

    /*
     * What the browser fires when this tab comes back into view. `pageshow` is
     * listened for too -- that is the back/forward cache, which restores the
     * spinner exactly as it was left -- but dispatching it by hand makes the
     * app reload itself, which is a different test than this one.
     */
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect.poll(() => marks(page), { timeout: 5_000 })
        .toEqual({ rows: 0, note: null, bar: false });
});

test('a new tab gets a pulse, not a wait', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(() => {
        const row = document.querySelector('.bookmark-link');
        window.dashboardInstance.visual.markBookmarkOpening({ row, newTab: true });
    });

    await expect.poll(async () => (await marks(page)).bar, { timeout: 5_000 }).toBe(true);
    // This tab is not going anywhere, so the mark clears itself.
    await expect.poll(() => marks(page), { timeout: 5_000 })
        .toEqual({ rows: 0, note: null, bar: false });
});

test('opening from search marks the row it came from', async ({ page }) => {
    await openDashboard(page);

    const name = await page.evaluate(() => {
        const bookmark = window.dashboardInstance.bookmarks?.[0]
            || window.dashboardInstance.allBookmarks?.[0];
        window.dashboardInstance.searchComponent.openBookmark(bookmark);
        return bookmark.name;
    });
    expect(name, 'no bookmark to open').toBeTruthy();

    await expect.poll(async () => (await marks(page)).bar, { timeout: 5_000 }).toBe(true);
    expect((await marks(page)).rows, 'the row it came from carries no mark').toBe(1);
});
