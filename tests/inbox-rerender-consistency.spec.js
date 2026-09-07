// @ts-check
const { test, expect } = require('./fixtures');

/**
 * Four handlers used to carry four slightly different copies of the same
 * reset-and-render sequence: the tile handler skipped the page-title updates,
 * the sort handler skipped the selection reset. Whichever behaviour is right,
 * it should be the same one everywhere.
 */
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markInboxTutorialSeen } = require('./e2e-helpers');

async function openInboxWithItems(page) {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (let i = 0; i < 6; i += 1) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://c${i}-${Date.now()}.example/x`, title: `C ${i}` }),
            });
        }
    });
    await page.locator('#page-nav-inbox-btn').click();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length)).toBeGreaterThan(0);
}

/** Capture nextdashTrack calls, same approach as tests/analytics-view-events.spec.js. */
async function captureTracks(page) {
    await page.evaluate(() => {
        window.__tracks = [];
        window.nextdashTrack = (name, props) => window.__tracks.push({ name, props });
    });
}

const tracks = (page) => page.evaluate(() => window.__tracks || []);

test('changing the sort clears the selection, like every other axis', async ({ page }) => {
    await openInboxWithItems(page);

    await page.evaluate(() => {
        const inbox = window.dashboardInstance.inbox;
        inbox.checkedIds.add(inbox.items[0].id);
        inbox.checkAnchorId = inbox.items[0].id;
    });

    await page.locator('[data-inbox-sort]').selectOption('oldest');

    const state = await page.evaluate(() => ({
        checked: window.dashboardInstance.inbox.checkedIds.size,
        anchor: window.dashboardInstance.inbox.checkAnchorId,
    }));
    expect(state).toEqual({ checked: 0, anchor: null });
});

test('every axis change goes through one path', async ({ page }) => {
    await openInboxWithItems(page);

    const calls = await page.evaluate(async () => {
        const inbox = window.dashboardInstance.inbox;
        const seen = [];
        const original = inbox.applyViewChange.bind(inbox);
        inbox.applyViewChange = (patch, options) => {
            seen.push({ patch: Object.keys(patch), via: options?.via });
            return original(patch, options);
        };
        document.querySelector('[data-inbox-filter="unread"]').click();
        const sort = document.querySelector('[data-inbox-sort]');
        sort.value = 'oldest';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
        return seen;
    });

    expect(calls.map((c) => c.patch[0])).toEqual(['filter', 'sort']);
    expect(calls.every((c) => typeof c.via === 'string')).toBe(true);
});

test('the search box keeps its caret while the list repaints', async ({ page }) => {
    await openInboxWithItems(page);

    const search = page.locator('[data-inbox-search]');
    await search.click();
    await search.type('C 1', { delay: 60 });
    await page.waitForTimeout(300);

    const caret = await page.evaluate(() => {
        const el = document.querySelector('[data-inbox-search]');
        return { focused: document.activeElement === el, start: el.selectionStart, value: el.value };
    });

    expect(caret.focused, 'the search box lost focus during a repaint').toBe(true);
    expect(caret.value).toBe('C 1');
    // 'C 1' is 3 characters; the caret belongs at the end of it, not reset to
    // 0 by a repaint mid-keystroke.
    expect(caret.start, 'the caret jumped').toBe(3);
});

test('the domain filter never sends the picked hostname to analytics', async ({ page }) => {
    await openInboxWithItems(page);

    const domainSelect = page.locator('.inbox-domain-select');
    await expect(domainSelect).toBeVisible();
    const host = await domainSelect.locator('option:not([value=""])').first().getAttribute('value');
    expect(host, 'seeded items should offer at least one site').toBeTruthy();

    await captureTracks(page);
    await domainSelect.selectOption(host);

    const seen = await tracks(page);
    // Historical event name and marker, restored: applyViewChange's patch
    // (the real hostname) must never reach _trackAction unredacted.
    const filterEvent = seen.find((t) => t.name === 'inbox:filter' && t.props?.filter === 'domain');
    expect(filterEvent, 'no inbox:filter event with the domain marker was seen').toBeTruthy();
    expect(JSON.stringify(filterEvent.props)).not.toContain(host);
    expect(filterEvent.props.domainFilter).toBeUndefined();
    // The old, silently-renamed event must not appear either.
    expect(seen.some((t) => t.name === 'inbox:domainFilter')).toBe(false);
});

test('typing in the search box fires no analytics event', async ({ page }) => {
    await openInboxWithItems(page);

    await captureTracks(page);
    const search = page.locator('[data-inbox-search]');
    await search.click();
    await search.type('C 1', { delay: 60 });
    await page.waitForTimeout(300);

    const seen = await tracks(page);
    expect(seen.filter((t) => t.name.startsWith('inbox:'))).toEqual([]);
});
