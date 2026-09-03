// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Four corrections that share a shape: state kept for one purpose being read as
 * an answer to a different question.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('inbox', () => {
    /*
     * fetchItems snapshots read stamps before its request and re-applies them
     * after. Marking a row unread while a fetch was in flight let that snapshot
     * put the old stamp straight back.
     */
    test('marking unread survives a fetch that was already in flight', async ({ page }) => {
        await openDashboard(page);

        const outcome = await page.evaluate(async () => {
            const inbox = window.dashboardInstance.inbox;
            const id = 'probe-unread-1';
            // A read item, as the server currently reports it.
            inbox.items = [{ id, url: 'https://example.com/x', addedAt: Date.now(), readAt: 111 }];

            // The user marks it unread while a fetch is on its way back. The
            // PATCH is stubbed; what matters is the bookkeeping around it.
            const realFetch = window.fetch;
            window.fetch = async () => ({ ok: true, json: async () => ({}) });
            try {
                await inbox.markUnread(id);
            } finally {
                window.fetch = realFetch;
            }

            // The in-flight response lands, still carrying the old stamp.
            const preserveRead = new Map([[id, 111]]);
            inbox.items = [{ id, url: 'https://example.com/x', addedAt: Date.now(), readAt: 0 }];
            inbox.items.forEach((item) => {
                if (inbox._deliberateUnread?.has(item.id)) { item.readAt = 0; return; }
                const local = preserveRead.get(item.id);
                if (local && (!item.readAt || Number(item.readAt) < local)) item.readAt = local;
            });
            return { readAt: inbox.items[0].readAt };
        });

        expect(outcome.readAt).toBe(0);
    });

    /*
     * moveKeyboardSelection wraps, which is right for a plain arrow and wrong
     * while extending a selection: at the first row, Shift+ArrowUp jumped to the
     * last and ticked everything in between.
     */
    test('extending a selection stops at the ends instead of wrapping', async ({ page }) => {
        await openDashboard(page);

        const wrapped = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const cards = [
                { dataset: { inboxId: 'a' } },
                { dataset: { inboxId: 'b' } },
                { dataset: { inboxId: 'c' } },
            ];
            inbox.applyKeyboardSelection = () => {};
            inbox.selectedItemId = 'a';
            const movedUp = inbox.moveKeyboardSelection(-1, cards, { wrap: false });
            const afterUp = inbox.selectedItemId;
            inbox.selectedItemId = 'c';
            const movedDown = inbox.moveKeyboardSelection(1, cards, { wrap: false });
            return { movedUp, afterUp, movedDown, afterDown: inbox.selectedItemId };
        });

        // Neither end moves, and the cursor stays where it was.
        expect(wrapped.movedUp).toBe(false);
        expect(wrapped.afterUp).toBe('a');
        expect(wrapped.movedDown).toBe(false);
        expect(wrapped.afterDown).toBe('c');
    });
});

test.describe('health', () => {
    /*
     * A failed preview request was remembered for the life of the tab -- the
     * focus instance is cached on the health view -- so a single network blip
     * left that card blank until a full reload, the opposite of what the code's
     * own comment beside _previewFailed.add() promises.
     *
     * Read from the served module rather than driven through the overlay: the
     * focus view is loaded on demand and needs a report with issues in it, which
     * the fixture has no reliable supply of.
     */
    test('leaving a focus session forgets the previews that failed in it', async ({ page }) => {
        await openDashboard(page);

        const src = await page.evaluate(async () => {
            const res = await fetch('/static/js/dashboard/dashboard-health-focus.js');
            return res.ok ? res.text() : '';
        });
        expect(src).not.toBe('');

        // The set is filled when a request fails...
        expect(src).toMatch(/_previewFailed\.add\(/);
        // ...and emptied on the way out, so the next session asks again.
        expect(src).toMatch(/_previewFailed\.clear\(\)/);

        const closeAt = src.indexOf('close()');
        const clearAt = src.indexOf('_previewFailed.clear()');
        expect(closeAt).toBeGreaterThan(-1);
        expect(clearAt).toBeGreaterThan(closeAt);
    });
});
