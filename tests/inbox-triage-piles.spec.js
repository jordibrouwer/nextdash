// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Triage in the shape of Work through: first a pile, then one link at a time
 * with where it came from and one clear next step, then what the run did.
 *
 * The inbox is mocked so the ages are real: the server stamps addedAt itself,
 * and "waiting longest" needs links from weeks ago.
 */

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const link = (id, title, ageDays, extra = {}) => ({
    id, url: `https://${id}.example/x`, title, domain: `${id}.example`,
    addedAt: now - ageDays * DAY, source: 'extension', ...extra,
});
const ITEMS = [
    // Not in age order, so the pile has to sort them.
    link('old3', 'Old three', 9),
    link('old1', 'Old one', 20, { note: 'for the NAS rebuild' }),
    link('old2', 'Old two', 12, { source: 'paste' }),
    link('new1', 'New one', 1),
    link('new2', 'New two', 2),
    link('read1', 'Read already', 30, { readAt: now - DAY }),
];

async function openInbox(page) {
    const items = ITEMS.map((i) => ({ ...i }));
    await page.route('**/api/inbox**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname !== '/api/inbox') return route.fallback();
        if (req.method() === 'GET') {
            return route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ version: 1, items }) });
        }
        if (req.method() === 'PATCH') {
            const body = req.postDataJSON() || {};
            const hit = items.find((i) => i.id === body.id);
            if (hit && body.readAt !== undefined) hit.readAt = body.readAt || now;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit || {}) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() => (window.dashboardInstance.inbox.items || []).length)).toBe(6);
}

const chooser = (page) => page.locator('[data-triage-chooser]');
const card = (page) => page.locator('#inbox-triage-overlay .health-focus-card');

test.describe('triage, pile first', () => {
    test('t asks which pile, each with its count', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        await expect(chooser(page)).toBeVisible();
        const piles = await chooser(page).locator('[data-triage-pile]').evaluateAll((els) =>
            els.map((el) => [el.getAttribute('data-triage-pile'), el.querySelector('.health-focus-pile-count')?.textContent]));
        // Unread only; the fullest fixed pile first, the list as filtered last.
        expect(piles).toEqual([['waiting', '3'], ['new', '2'], ['noted', '1'], ['list', '5']]);
    });

    test('a pile walks its links: waiting longest is oldest first', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        await page.keyboard.press('Enter');
        await expect(card(page).locator('.health-focus-progress')).toHaveText(/^Waiting longest · 1 of 3$/);
        await expect(card(page).locator('.health-focus-title')).toHaveText('Old one');
    });

    test('the card says where the link came from, and Promote leads', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        await page.keyboard.press('Enter');
        const why = card(page).locator('.health-focus-why');
        await expect(why).toContainText('extension');
        await expect(why).toContainText('never opened');
        await expect(why).toContainText('for the NAS rebuild');
        await expect(card(page).locator('.health-focus-primary')).toHaveAttribute('data-triage', 'promote');
        await expect(card(page).locator('.health-focus-alts [data-triage="delete"]')).toBeVisible();
        await expect(card(page).locator('.health-focus-foot [data-triage="snooze"]')).toBeVisible();
    });

    test('the end of a pile counts what was done and offers the next', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        await page.locator('[data-triage-pile="new"]').click();
        await expect(card(page).locator('.health-focus-progress')).toHaveText(/^New this week · 1 of 2$/);
        await page.keyboard.press('r');
        await page.keyboard.press('r');
        const done = page.locator('#inbox-triage-overlay .health-focus-card--done');
        await expect(done).toBeVisible();
        await expect(done.locator('.health-focus-stat', { hasText: 'read' })).toContainText('2');
        await expect(done.locator('[data-triage="next-pile"]')).toContainText('Waiting longest');
    });

    test('a second r while the first read is on the wire reads the next card', async ({ page }) => {
        await openInbox(page);
        // Held long enough that the second press always lands mid-write. It
        // was dropped: the cursor had not moved, and the card was still claimed.
        await page.route('**/api/inbox', async (route) => {
            if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 600));
            await route.fallback();
        });
        await page.keyboard.press('t');
        await page.locator('[data-triage-pile="new"]').click();
        await expect(card(page).locator('.health-focus-progress')).toHaveText(/^New this week · 1 of 2$/);
        await page.keyboard.press('r');
        await page.keyboard.press('r');
        const done = page.locator('#inbox-triage-overlay .health-focus-card--done');
        await expect(done).toBeVisible();
        await expect(done.locator('.health-focus-stat', { hasText: 'read' })).toContainText('2');
    });

    test('Enter on a focused button presses that button', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        // A pile reached by Tab starts, not the highlighted one.
        await chooser(page).locator('[data-triage-pile="noted"]').focus();
        await page.keyboard.press('Enter');
        await expect(card(page).locator('.health-focus-progress')).toHaveText(/^With a note · 1 of 1$/);

        // Enter on Mark read marks it read; it used to open the link.
        await page.evaluate(() => { window.__opened = 0; window.open = () => { window.__opened += 1; return null; }; });
        await card(page).locator('[data-triage="read"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#inbox-triage-overlay .health-focus-card--done')).toBeVisible();
        expect(await page.evaluate(() => window.__opened)).toBe(0);

        // And × closes.
        await page.locator('#inbox-triage-overlay .inbox-triage-close').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#inbox-triage-overlay')).toHaveCount(0);
    });

    test('a pile that emptied after it was counted leaves the chooser working', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        await expect(chooser(page).locator('[data-triage-pile="noted"]')).toBeVisible();
        // Read elsewhere while the chooser was up.
        await page.evaluate(() => {
            const hit = window.dashboardInstance.inbox.items.find((i) => i.id === 'old1');
            hit.readAt = Date.now();
        });
        await chooser(page).locator('[data-triage-pile="noted"]').click();
        await expect(chooser(page)).toBeVisible();
        await expect(chooser(page).locator('[data-triage-pile="noted"]')).toHaveCount(0);
        await page.keyboard.press('Enter');
        await expect(card(page).locator('.health-focus-progress')).toHaveText(/^Waiting longest · 1 of 2$/);
    });

    test('Escape at the pile leaves without a run', async ({ page }) => {
        await openInbox(page);
        await page.keyboard.press('t');
        await expect(chooser(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#inbox-triage-overlay')).toHaveCount(0);
    });
});
