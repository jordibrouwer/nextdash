// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * What happens when marking an item read fails.
 *
 * markRead used to toast and return rather than throw, which meant it resolved
 * — so every caller treated a failed write as a success. The row greyed out,
 * markAllRead's partial-failure branch could never fire, and the user got an
 * error toast immediately followed by "Marked 1 read" about the same item. The
 * row came back unread on the next reload, which is the shape of bug that only
 * shows up once you no longer trust the screen.
 *
 * The PATCH is failed at the network layer rather than by breaking the server,
 * so these describe what the view does with a rejection — which is the half
 * that was wrong.
 */

async function openInboxWithOneUnread(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => {
        window.dashboardInstance.settings.inboxEnabled = true;
    });

    // The server and its data dir are shared across this file, and other specs
    // leave items behind. Rather than wiping shared state, everything below is
    // scoped to the id this returns — so the assertions describe one known row
    // regardless of what else is in the inbox.
    const url = `https://mark-read-${Date.now()}.example.com`;
    const id = await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Unread probe' }),
        });
        const body = await res.json();
        return body?.item?.id || '';
    }, url);
    expect(id).toBeTruthy();

    await page.locator('#page-nav-inbox-btn').click();
    await page.waitForSelector('.inbox-layout', { timeout: 10_000 });
    await page.waitForFunction(
        (wanted) => window.dashboardInstance.inbox.items.some((i) => i.id === wanted),
        id, { timeout: 10_000 },
    );
    return id;
}

/** Fail every PATCH to /api/inbox, leaving the other verbs alone. */
async function failPatches(page) {
    await page.route('**/api/inbox', async (route) => {
        if (route.request().method() === 'PATCH') {
            await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
            return;
        }
        await route.continue();
    });
}

/** Collect the toasts raised while `fn` runs. */
async function toastsDuring(page, fn) {
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        window.__toasts = [];
        d.__origNotify = d.showNotification.bind(d);
        d.showNotification = (m, t) => {
            window.__toasts.push({ type: t, message: String(m) });
            return d.__origNotify(m, t);
        };
    });
    await fn();
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        if (d.__origNotify) {
            d.showNotification = d.__origNotify;
        }
        return window.__toasts;
    });
}

test.describe('inbox — a failed mark-read is reported as one', () => {
    test('markAllRead does not claim success when the write failed', async ({ page }) => {
        const id = await openInboxWithOneUnread(page);
        await failPatches(page);

        const toasts = await toastsDuring(page, () =>
            page.evaluate(() => window.dashboardInstance.inbox.markAllRead()));

        // The contradiction this fixes: an error toast followed by a success
        // toast about the same item.
        const claimedSuccess = toasts.some((t) => /Marked \d+ read/.test(t.message));
        expect(claimedSuccess, `toasts were ${JSON.stringify(toasts)}`).toBe(false);
        expect(toasts.some((t) => /failed/i.test(t.message))).toBe(true);

        // And this item is genuinely still unread on the server.
        const stillUnread = await page.evaluate(async (wanted) => {
            const res = await fetch('/api/inbox');
            const data = await res.json();
            const row = (data.items || []).find((i) => i.id === wanted);
            return Boolean(row) && !row.readAt;
        }, id);
        expect(stillUnread).toBe(true);
    });

    test('the row is not greyed out by a write that never landed', async ({ page }) => {
        const id = await openInboxWithOneUnread(page);
        await failPatches(page);

        const row = page.locator(`[data-inbox-id="${id}"]`);
        await expect(row).toHaveClass(/is-unread/);

        await page.evaluate((wanted) => {
            const inbox = window.dashboardInstance.inbox;
            const item = inbox.items.find((i) => i.id === wanted);
            return inbox.markReadFromKeyboard(item);
        }, id);

        // Still unread: the row must not report a state the server rejected.
        await expect(row).toHaveClass(/is-unread/);
        await expect(row).not.toHaveClass(/is-read/);
    });

    test('a successful mark-read still greys the row out', async ({ page }) => {
        // The control: without this, the two tests above would pass just as
        // well against a markRead that never marks anything read.
        const id = await openInboxWithOneUnread(page);

        const row = page.locator(`[data-inbox-id="${id}"]`);
        await expect(row).toHaveClass(/is-unread/);
        await page.evaluate((wanted) => {
            const inbox = window.dashboardInstance.inbox;
            const item = inbox.items.find((i) => i.id === wanted);
            return inbox.markReadFromKeyboard(item);
        }, id);
        await expect(row).toHaveClass(/is-read/);

        const nowRead = await page.evaluate(async (wanted) => {
            const res = await fetch('/api/inbox');
            const data = await res.json();
            const found = (data.items || []).find((i) => i.id === wanted);
            return Boolean(found?.readAt);
        }, id);
        expect(nowRead).toBe(true);
    });

    test('bulk mark-read reports a failure instead of clearing silently', async ({ page }) => {
        const id = await openInboxWithOneUnread(page);
        await failPatches(page);

        const toasts = await toastsDuring(page, async () => {
            await page.evaluate((wanted) => {
                const inbox = window.dashboardInstance.inbox;
                inbox.checkedIds.add(wanted);
                return inbox.bulkMarkRead();
            }, id);
        });

        expect(toasts.some((t) => /failed/i.test(t.message)),
            `toasts were ${JSON.stringify(toasts)}`).toBe(true);
    });
});
